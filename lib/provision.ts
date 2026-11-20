import "server-only";
import { randomUUID } from "node:crypto";
import { controlPlaneUrl, domainName, ticketSecret } from "@/lib/config";
import { createDnsRecord, deleteDnsRecord } from "@/lib/cloudflare";
import { renderUserData } from "@/lib/cloud-init";
import { sendReadyEmail } from "@/lib/email";
import { parseGitHubRepo } from "@/lib/github";
import { fallbackNotice, maxMonthlyEur, placementPlan } from "@/lib/hetzner-types";
import {
  createFirewall,
  createServer,
  deleteFirewall,
  deleteServer,
  enableBackup,
  getServer,
  isCapacityError,
} from "@/lib/hetzner";
import { HttpError, publicError } from "@/lib/http";
import { isMockMode, mockProvisionMs } from "@/lib/mode";
import { parseAppPort } from "@/lib/ports";
import { mockIsReady } from "@/lib/progress";
import { candidateSlug, isSafeSlug, withSuffix } from "@/lib/slug";
import { getStripe, stripeId } from "@/lib/stripe-client";
import { store } from "@/lib/store";
import { readPayload, sha256, signPayload } from "@/lib/tokens";
import type { Box, Subscription, SubscriptionStatus } from "@/lib/types";

const PROVISION_TIMEOUT_MS = 20 * 60 * 1000;
const RESUME_AFTER_MS = 90 * 1000;

export async function loadAccount(userId: string) {
  await syncBox(userId);
  const [subscription, box] = await Promise.all([store().getSubscription(userId), store().getBoxByUser(userId)]);
  return { subscription, box };
}

export async function activateAndProvision(
  userId: string,
  input: { customerId: string | null; subscriptionId: string | null },
) {
  let currentPeriodEnd: string | null = null;
  if (!isMockMode() && input.subscriptionId) {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
    currentPeriodEnd = periodEnd(subscription);
    input.customerId = input.customerId ?? stripeId(subscription.customer);
  }
  const existing = await store().getSubscription(userId);
  const next: Subscription = {
    userId,
    stripeCustomerId: input.customerId ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: input.subscriptionId ?? existing?.stripeSubscriptionId ?? null,
    status: "active",
    currentPeriodEnd,
  };
  await store().upsertSubscription(next);
  if (input.customerId) await store().setStripeCustomer(userId, input.customerId);
  return ensureBox(userId, next.stripeSubscriptionId);
}

export async function ensureBox(userId: string, subscriptionId: string | null) {
  if (isMockMode()) return ensureMockBox(userId, subscriptionId);
  return ensureLiveBox(userId, subscriptionId);
}

async function ensureMockBox(userId: string, subscriptionId: string | null) {
  const existing = await store().getBoxByUser(userId);
  if (existing && (existing.status === "provisioning" || existing.status === "running")) return existing;
  const box = freshBox(userId, await uniqueSlug(), subscriptionId);
  if (existing) {
    box.id = existing.id;
    await store().saveBox(box);
  } else {
    await store().insertBox(box);
  }
  return box;
}

async function ensureLiveBox(userId: string, subscriptionId: string | null) {
  const existing = await store().getBoxByUser(userId);
  if (existing && (existing.status === "running" || existing.status === "destroying")) return existing;
  if (existing?.status === "waiting") return existing;
  if (existing?.status === "provisioning") {
    if (existing.hetznerServerId) return existing;
    const age = Date.now() - new Date(existing.createdAt).getTime();
    if (age < RESUME_AFTER_MS) return existing;
    return continueLiveProvision(existing);
  }
  if (existing && (existing.status === "error" || existing.status === "destroyed")) {
    await destroyResources(existing);
  }
  const box = freshBox(userId, await uniqueSlug(), subscriptionId);
  if (existing) {
    box.id = existing.id;
    await store().saveBox(box);
  } else {
    try {
      await store().insertBox(box);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        const winner = await store().getBoxByUser(userId);
        if (winner) return winner;
      }
      throw error;
    }
  }
  return continueLiveProvision(box);
}

async function continueLiveProvision(box: Box) {
  const plane = controlPlaneUrl();
  if (!plane.startsWith("https://")) {
    throw new HttpError(500, "CHILLRIG_CONTROL_PLANE must be an https URL");
  }
  const domain = domainName();
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) {
    throw new HttpError(500, "CHILLRIG_DOMAIN is not a hostname");
  }
  const token = signPayload(
    {
      purpose: "ready",
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
      boxId: box.id,
      slug: box.slug,
    },
    ticketSecret(),
  );
  box.provisionTokenHash = sha256(token);
  await store().saveBox(box);
  const userData = renderUserData({
    CHILLRIG_DOMAIN: `${box.slug}.${domain}`,
    CHILLRIG_CONTROL_PLANE: plane,
    CHILLRIG_ACME_EMAIL: process.env.ACME_EMAIL || `admin@${domain}`,
    CHILLRIG_READY_URL: `${plane}/api/boxes/ready`,
    CHILLRIG_READY_TOKEN: token,
    CHILLRIG_APP_PORT: String(box.appPort),
    CHILLRIG_SLUG: box.slug,
    CHILLRIG_CLOSE_SSH: "1",
  });
  const plan = placementPlan({
    types: process.env.HETZNER_SERVER_TYPES,
    singleType: process.env.HETZNER_SERVER_TYPE,
    locations: process.env.HETZNER_LOCATIONS,
    preferredLocation: process.env.HETZNER_LOCATION,
    maxMonthlyEur: maxMonthlyEur(process.env.HETZNER_MAX_MONTHLY_EUR),
  });
  let created: Awaited<ReturnType<typeof createServer>> | null = null;
  let placed = plan[0];
  let lastError: unknown = null;
  for (const attempt of plan) {
    try {
      created = await createServer({
        name: `box-${box.slug}`,
        userData,
        location: attempt.location,
        serverType: attempt.serverType,
      });
      placed = attempt;
      const notice = plan[0] ? fallbackNotice(attempt, plan[0]) : null;
      if (notice) console.warn(notice);
      break;
    } catch (error) {
      lastError = error;
      if (!isCapacityError(error)) break;
      console.warn(`Hetzner ${attempt.serverType} in ${attempt.location} is unavailable`);
    }
  }
  if (!created || !placed) {
    if (!lastError || isCapacityError(lastError)) {
      box.status = "waiting";
      box.error = null;
      box.hetznerServerId = null;
      box.lastSyncAt = new Date().toISOString();
      await store().saveBox(box);
      console.warn("No Hetzner capacity under the monthly cap; waiting");
      return box;
    }
    box.status = "error";
    box.error = publicError(lastError);
    await store().saveBox(box);
    throw new HttpError(502, box.error || "Could not create the machine");
  }
  box.hetznerServerId = created.id;
  box.ipv4 = created.ipv4;
  box.region = placed.location;
  box.serverType = placed.serverType;
  box.status = "provisioning";
  await store().saveBox(box);
  try {
    await enableBackup(created.id);
    box.backupEnabled = true;
  } catch {
    box.backupEnabled = false;
  }
  await store().saveBox(box);
  try {
    box.hetznerFirewallId = await createFirewall(`fw-${box.slug}`, created.id);
    await store().saveBox(box);
    if (!box.ipv4) throw new Error("The machine has no IPv4 address");
    box.dnsRecordId = await createDnsRecord(box.slug, box.ipv4);
    box.error = null;
    await store().saveBox(box);
  } catch (error) {
    await destroyResources(box);
    box.status = "error";
    box.error = publicError(error);
    box.hetznerServerId = null;
    box.hetznerFirewallId = null;
    box.dnsRecordId = null;
    box.ipv4 = null;
    await store().saveBox(box);
    throw new HttpError(502, box.error);
  }
  return box;
}

export async function syncBox(userId: string) {
  const box = await store().getBoxByUser(userId);
  if (!box) return null;
  if (isMockMode()) {
    if (box.status === "provisioning" && mockIsReady(Date.now() - new Date(box.createdAt).getTime(), mockProvisionMs())) {
      await store().markReady(box.id);
    }
    return store().getBoxByUser(userId);
  }
  if (box.status === "waiting") {
    const last = box.lastSyncAt ? new Date(box.lastSyncAt).getTime() : 0;
    if (Date.now() - last < 60_000) return box;
    const claimed = await store().claimSync(box.id, box.lastSyncAt);
    if (!claimed) return store().getBoxByUser(userId);
    return continueLiveProvision(box);
  }
  if (box.status !== "provisioning" && box.status !== "running") return box;
  const staleMs = box.status === "provisioning" ? 3000 : 60_000;
  const last = box.lastSyncAt ? new Date(box.lastSyncAt).getTime() : 0;
  if (Date.now() - last < staleMs) return box;
  const claimed = await store().claimSync(box.id, box.lastSyncAt);
  if (!claimed) return store().getBoxByUser(userId);
  return syncLive(box.id);
}

async function syncLive(id: string) {
  const box = await store().getBoxById(id);
  if (!box || !box.hetznerServerId) return box;
  try {
    const server = await getServer(box.hetznerServerId);
    if (!server) {
      box.status = "error";
      box.error = "The machine is gone";
      await store().saveBox(box);
      return box;
    }
    if (!box.dnsRecordId && box.ipv4 && box.status === "provisioning") {
      box.dnsRecordId = await createDnsRecord(box.slug, box.ipv4);
      await store().saveBox(box);
    }
    if (box.status === "provisioning" && server.status === "running" && box.dnsRecordId) {
      if (await probeReady(`${box.slug}.${domainName()}`)) {
        await finishReady(box);
      } else if (Date.now() - new Date(box.createdAt).getTime() > PROVISION_TIMEOUT_MS) {
        box.status = "error";
        box.error = "Setup did not finish";
        await store().saveBox(box);
      }
    }
  } catch (error) {
    if (box.status === "provisioning") {
      box.error = publicError(error);
      await store().saveBox(box);
    }
  }
  return store().getBoxById(id);
}

async function probeReady(hostname: string) {
  try {
    const response = await fetch(`https://${hostname}/_chillrig/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function finishReady(box: Box) {
  const ready = await store().markReady(box.id);
  if (!ready || isMockMode()) return;
  const profile = await store().getProfile(ready.userId);
  if (!profile) return;
  try {
    await sendReadyEmail(profile, `${ready.slug}.${domainName()}`);
  } catch {
    // The box is ready even if the optional email fails.
  }
}

export async function completeReadyToken(token: string) {
  const payload = readReady(token);
  if (!payload) return false;
  const consumed = await store().consumeProvisionToken(payload.boxId, sha256(token));
  if (!consumed) return false;
  const box = await store().getBoxById(payload.boxId);
  if (!box || box.slug !== payload.slug || box.status === "destroyed" || box.status === "destroying") return false;
  await finishReady(box);
  return true;
}

function readReady(token: string) {
  const payload = readPayload<{ purpose: string; exp: number; boxId?: string; slug?: string }>(token, ticketSecret());
  if (!payload || payload.purpose !== "ready" || !payload.boxId || !payload.slug) return null;
  return { boxId: payload.boxId, slug: payload.slug };
}

export async function destroyUserBox(userId: string) {
  const box = await store().getBoxByUser(userId);
  if (!box || box.status === "destroyed") return;
  box.status = "destroying";
  await store().saveBox(box);
  try {
    if (!isMockMode()) await destroyResources(box);
  } catch (error) {
    box.status = "error";
    box.error = publicError(error);
    await store().saveBox(box);
    return;
  }
  box.status = "destroyed";
  box.destroyedAt = new Date().toISOString();
  box.ipv4 = null;
  box.hetznerServerId = null;
  box.hetznerFirewallId = null;
  box.dnsRecordId = null;
  box.provisionTokenHash = null;
  await store().saveBox(box);
}

async function destroyResources(box: Box) {
  if (box.hetznerServerId) await deleteServer(box.hetznerServerId);
  if (box.hetznerFirewallId) await deleteFirewall(box.hetznerFirewallId);
  if (box.dnsRecordId) await deleteDnsRecord(box.dnsRecordId);
}

export async function cloneOnBox(userId: string, rawUrl: string) {
  const repo = parseGitHubRepo(rawUrl);
  if (!repo) throw new HttpError(400, "Use a public https://github.com/owner/repo URL");
  const box = await runningBox(userId);
  if (isMockMode()) {
    box.githubClone = { url: repo.url, path: `~/projects/${repo.repo}`, at: new Date().toISOString() };
    await store().saveBox(box);
    return box.githubClone;
  }
  const ticket = boxTicket(userId, box);
  const response = await fetch(`https://${box.slug}.${domainName()}/_chillrig/clone?ticket=${encodeURIComponent(ticket)}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", "x-chillrig-ticket": ticket },
    body: JSON.stringify({ url: repo.url }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; path?: string };
  if (!response.ok) throw new HttpError(response.status === 409 ? 409 : 502, payload.error || "Clone failed");
  const clone = { url: repo.url, path: payload.path || `~/projects/${repo.repo}`, at: new Date().toISOString() };
  box.githubClone = clone;
  await store().saveBox(box);
  return clone;
}

export async function setBoxPort(userId: string, value: unknown) {
  const port = parseAppPort(value);
  if (!port) throw new HttpError(400, "Choose a port from 1024 up, other than the terminal ports");
  const box = await runningBox(userId);
  if (!isMockMode()) {
    const ticket = boxTicket(userId, box);
    const response = await fetch(`https://${box.slug}.${domainName()}/_chillrig/port?ticket=${encodeURIComponent(ticket)}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", "x-chillrig-ticket": ticket },
      body: JSON.stringify({ port }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new HttpError(502, "Could not update the port");
  }
  box.appPort = port;
  await store().saveBox(box);
  return port;
}

export function issueBoxTicket(userId: string, box: Box) {
  if (box.status !== "running" && box.status !== "provisioning") {
    throw new HttpError(409, "The box is not running");
  }
  return {
    ticket: boxTicket(userId, box),
    hostname: `${box.slug}.${domainName()}`,
    wsPath: "/ttyd/ws",
  };
}

export async function verifyBoxTicket(token: string, host: string) {
  const payload = readBoxTicket(token);
  if (!payload) return false;
  const hostname = host.split(":")[0]?.toLowerCase();
  if (hostname !== `${payload.slug}.${domainName()}`) return false;
  const box = await store().getBoxById(payload.boxId);
  if (!box || box.userId !== payload.sub || box.slug !== payload.slug) return false;
  return box.status === "running" || box.status === "provisioning";
}

async function runningBox(userId: string) {
  const box = await store().getBoxByUser(userId);
  if (!box || box.status !== "running") throw new HttpError(409, "Your box is not running");
  return box;
}

function boxTicket(userId: string, box: Box) {
  return signPayload(
    {
      purpose: "box",
      exp: Math.floor(Date.now() / 1000) + 90,
      sub: userId,
      boxId: box.id,
      slug: box.slug,
    },
    ticketSecret(),
  );
}

function readBoxTicket(token: string) {
  const payload = readPayload<{ purpose: string; exp: number; sub?: string; boxId?: string; slug?: string }>(
    token,
    ticketSecret(),
  );
  if (!payload || payload.purpose !== "box" || !payload.sub || !payload.boxId || !payload.slug) return null;
  return { sub: payload.sub, boxId: payload.boxId, slug: payload.slug };
}

async function uniqueSlug() {
  const taken = new Set(await store().listSlugs());
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = attempt === 0 ? candidateSlug() : withSuffix(candidateSlug());
    if (!taken.has(slug) && isSafeSlug(slug)) return slug;
  }
  return `box-${randomUUID().slice(0, 8)}`;
}

function freshBox(userId: string, slug: string, subscriptionId: string | null): Box {
  return {
    id: randomUUID(),
    userId,
    slug,
    status: "provisioning",
    hetznerServerId: null,
    hetznerFirewallId: null,
    ipv4: null,
    region: process.env.HETZNER_LOCATION || "fsn1",
    serverType: null,
    appPort: 3000,
    stripeSubscriptionId: subscriptionId,
    dnsRecordId: null,
    provisionTokenHash: null,
    error: null,
    githubClone: null,
    createdAt: new Date().toISOString(),
    readyAt: null,
    destroyedAt: null,
    lastSyncAt: null,
    backupEnabled: false,
  };
}

export async function markSubscription(
  userId: string,
  status: SubscriptionStatus,
  subscriptionId: string | null,
  customerId: string | null,
) {
  const existing = await store().getSubscription(userId);
  await store().upsertSubscription({
    userId,
    status,
    stripeSubscriptionId: subscriptionId ?? existing?.stripeSubscriptionId ?? null,
    stripeCustomerId: customerId ?? existing?.stripeCustomerId ?? null,
    currentPeriodEnd: existing?.currentPeriodEnd ?? null,
  });
}

function periodEnd(subscription: {
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
}) {
  const raw = subscription as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const stamp = raw.current_period_end ?? raw.items?.data?.[0]?.current_period_end;
  return stamp ? new Date(stamp * 1000).toISOString() : null;
}
