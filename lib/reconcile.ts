import "server-only";
import { createHash } from "node:crypto";
import { sendAlertEmail } from "@/lib/email";
import { deleteFirewall, deleteServer, listFirewalls, listServers } from "@/lib/hetzner";
import { isMockMode } from "@/lib/mode";
import { destroyUserBox } from "@/lib/provision";
import { getStripe } from "@/lib/stripe-client";
import { store } from "@/lib/store";

/**
 * Daily safety net against paying Hetzner for machines nobody pays us for.
 *
 * Only touches resources this app created: servers named `box-<slug>` with the
 * `chillrig=1` label, and firewalls named `fw-<slug>` that are attached to nothing.
 * Anything younger than MIN_AGE_MS is left alone, so a box that is being created or a
 * webhook that is still in flight can never race this job.
 *
 * Dry run unless CHILLRIG_RECONCILE_DELETE=1: it then only logs what it would delete.
 * A Stripe or database error skips that server instead of deleting it.
 */

const MIN_AGE_MS = 2 * 60 * 60 * 1000;
const INCOMPLETE_GRACE_MS = 24 * 60 * 60 * 1000;
const PAST_DUE_ALERT_DAYS = 14;
const SERVER_NAME = /^box-[a-z0-9][a-z0-9-]{0,62}$/;
const FIREWALL_NAME = /^fw-[a-z0-9][a-z0-9-]{0,62}$/;

export type ReconcileFinding = {
  kind: "server" | "firewall";
  id: number;
  name: string;
  action: "delete" | "keep" | "skip" | "alert";
  reason: string;
  deleted?: boolean;
};

export function reconcileDeletes() {
  const flag = process.env.CHILLRIG_RECONCILE_DELETE?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** Shared secret for the cron call, derived so no extra secret has to be configured. */
export function cronToken(secret = process.env.SESSION_SECRET || "") {
  if (!secret) return "";
  return createHash("sha256").update(`chillrig-cron:${secret}`).digest("hex");
}

export async function reconcileHetzner(options: { apply?: boolean; now?: number } = {}) {
  const apply = options.apply ?? reconcileDeletes();
  const now = options.now ?? Date.now();
  const findings: ReconcileFinding[] = [];
  if (isMockMode()) return { apply, findings };

  const servers = await listServers();
  const liveFirewalls = new Set<number>();

  for (const server of servers) {
    const base = { kind: "server" as const, id: server.id, name: server.name };
    if (!SERVER_NAME.test(server.name) || server.labels.chillrig !== "1") {
      findings.push({ ...base, action: "skip", reason: "not a Chillrig box" });
      continue;
    }
    const age = now - new Date(server.created).getTime();
    if (!(age >= MIN_AGE_MS)) {
      findings.push({ ...base, action: "keep", reason: "younger than 2 hours" });
      continue;
    }
    let verdict: { action: ReconcileFinding["action"]; reason: string };
    try {
      verdict = await judgeServer(server.id, server.name.slice(4), age, now);
    } catch (error) {
      verdict = { action: "skip", reason: `lookup failed: ${message(error)}` };
    }
    const finding: ReconcileFinding = { ...base, ...verdict };
    if (verdict.action === "keep" || verdict.action === "alert") {
      const box = await store().getBoxBySlug(server.name.slice(4)).catch(() => null);
      if (box?.hetznerFirewallId) liveFirewalls.add(box.hetznerFirewallId);
    }
    if (verdict.action === "delete" && apply) {
      try {
        const box = await store().getBoxBySlug(server.name.slice(4));
        if (box && box.hetznerServerId === server.id) await destroyUserBox(box.userId);
        else await deleteServer(server.id);
        finding.deleted = true;
      } catch (error) {
        finding.deleted = false;
        finding.reason += `; delete failed: ${message(error)}`;
      }
    }
    findings.push(finding);
  }

  const firewalls = await listFirewalls();
  for (const firewall of firewalls) {
    const base = { kind: "firewall" as const, id: firewall.id, name: firewall.name };
    if (!FIREWALL_NAME.test(firewall.name)) continue;
    if (firewall.attached > 0 || liveFirewalls.has(firewall.id)) continue;
    if (!(now - new Date(firewall.created).getTime() >= MIN_AGE_MS)) continue;
    const finding: ReconcileFinding = { ...base, action: "delete", reason: "attached to nothing" };
    if (apply) {
      try {
        await deleteFirewall(firewall.id);
        finding.deleted = true;
      } catch (error) {
        finding.deleted = false;
        finding.reason += `; delete failed: ${message(error)}`;
      }
    }
    findings.push(finding);
  }

  const notable = findings.filter((item) => item.action === "delete" || item.action === "alert" || item.reason.startsWith("lookup failed"));
  console.log(JSON.stringify({ reconcile: apply ? "apply" : "dry-run", servers: servers.length, notable }));
  if (notable.length > 0) {
    const lines = notable.map(
      (item) => `${item.kind} ${item.name} (${item.id}): ${item.action}${item.deleted === undefined ? "" : item.deleted ? " [deleted]" : " [NOT deleted]"} - ${item.reason}`,
    );
    try {
      await sendAlertEmail(
        `Chillrig reconcile${apply ? "" : " (dry run)"}: ${notable.length} finding(s)`,
        `${lines.join("\n")}\n\nMode: ${apply ? "deleting" : "dry run, nothing deleted (set CHILLRIG_RECONCILE_DELETE=1 to act)"}\n`,
      );
    } catch {
      // Logged above; the email is optional.
    }
  }
  return { apply, findings };
}

async function judgeServer(serverId: number, slug: string, age: number, now: number) {
  const box = await store().getBoxBySlug(slug);
  if (!box) return { action: "delete" as const, reason: "no box record" };
  if (box.hetznerServerId !== serverId) return { action: "delete" as const, reason: "box record points at another server" };
  if (box.status === "destroyed") return { action: "delete" as const, reason: "box is marked destroyed" };
  const subscriptionId = box.stripeSubscriptionId || (await store().getSubscription(box.userId))?.stripeSubscriptionId || null;
  if (!subscriptionId) return { action: "delete" as const, reason: "no subscription" };
  let status: string;
  let since: number | null = null;
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    status = subscription.status;
    since = subscription.status === "past_due" ? pastDueSince(subscription) : null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "resource_missing") return { action: "delete" as const, reason: "subscription not found in Stripe" };
    throw error;
  }
  if (status === "active" || status === "trialing") return { action: "keep" as const, reason: `subscription ${status}` };
  if (status === "past_due") {
    const days = since ? Math.floor((now - since) / 86_400_000) : null;
    if (days !== null && days >= PAST_DUE_ALERT_DAYS) {
      return { action: "alert" as const, reason: `past_due for ${days} days; check Stripe retry settings` };
    }
    return { action: "keep" as const, reason: "subscription past_due (Stripe is retrying)" };
  }
  if (status === "incomplete" && age < INCOMPLETE_GRACE_MS) return { action: "keep" as const, reason: "subscription incomplete, under 24h" };
  return { action: "delete" as const, reason: `subscription ${status}` };
}

function pastDueSince(subscription: { latest_invoice?: unknown }) {
  const invoice = subscription.latest_invoice;
  if (invoice && typeof invoice === "object" && "created" in invoice && typeof invoice.created === "number") {
    return invoice.created * 1000;
  }
  return null;
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}
