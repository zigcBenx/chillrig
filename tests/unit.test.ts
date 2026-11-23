import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { subscriptionAllowsBox, subscriptionEndsBox } from "../lib/billing-policy";
import { effectiveMonthlyEur, fallbackNotice, inStock, isPricierThanPlan, placementPlan, PLAN_MONTHLY_EUR } from "../lib/hetzner-types";
import { renderUserData } from "../lib/cloud-init";
import { boxHostname, sslipHostname } from "../lib/hostname";
import { parseGitHubRepo } from "../lib/github";
import { buildSteps, mockIndex, mockIsReady } from "../lib/progress";
import { parseAppPort } from "../lib/ports";
import { safeNext } from "../lib/safe-next";
import { shellQuote } from "../lib/shell";
import { candidateSlug, isSafeSlug } from "../lib/slug";
import { readPayload, signPayload } from "../lib/tokens";
import { toAccountView } from "../lib/view";
import type { Box, SessionUser } from "../lib/types";

describe("tokens", () => {
  it("round-trips a payload and rejects tampering", () => {
    const token = signPayload({ purpose: "box", exp: Math.floor(Date.now() / 1000) + 60, slug: "calm-otter" }, "secret");
    const payload = readPayload(token, "secret") as { purpose: string; slug?: string } | null;
    assert.equal(payload?.purpose, "box");
    assert.equal(payload?.slug, "calm-otter");
    assert.equal(readPayload(token, "other"), null);
    assert.equal(readPayload(`${token}x`, "secret"), null);
    const expired = signPayload({ purpose: "box", exp: Math.floor(Date.now() / 1000) - 10 }, "secret");
    assert.equal(readPayload(expired, "secret"), null);
  });
});

describe("github urls", () => {
  it("accepts a public https repo and rejects everything else", () => {
    assert.deepEqual(parseGitHubRepo("https://github.com/acme/widget.git"), {
      url: "https://github.com/acme/widget.git",
      owner: "acme",
      repo: "widget",
    });
    assert.equal(parseGitHubRepo("https://user:token@github.com/acme/widget"), null);
    assert.equal(parseGitHubRepo("git@github.com:acme/widget.git"), null);
    assert.equal(parseGitHubRepo("https://gitlab.com/acme/widget"), null);
    assert.equal(parseGitHubRepo("https://github.com/acme/widget?token=1"), null);
  });
});

describe("guards", () => {
  it("quotes shell values and keeps redirects local", () => {
    assert.equal(shellQuote("abc'def"), `'abc'\\''def'`);
    assert.equal(safeNext("/dashboard"), "/dashboard");
    assert.equal(safeNext("https://evil.example"), "/go");
    assert.equal(safeNext("//evil.example"), "/go");
    assert.equal(parseAppPort(3000), 3000);
    assert.equal(parseAppPort(22), null);
    assert.equal(parseAppPort(7681), null);
    const slug = candidateSlug(() => 0);
    assert.equal(isSafeSlug(slug), true);
  });
});

describe("provision progress", () => {
  it("advances the mock steps and then finishes", () => {
    assert.equal(mockIndex(0, 7000), 0);
    assert.equal(mockIndex(2000, 7000), 1);
    assert.equal(mockIndex(4000, 7000), 2);
    assert.equal(mockIndex(5600, 7000), 3);
    assert.equal(mockIsReady(6999, 7000), false);
    assert.equal(mockIsReady(7000, 7000), true);
    assert.equal(buildSteps(1, false)[0]?.state, "done");
    assert.equal(buildSteps(1, false)[1]?.state, "current");
    assert.ok(buildSteps(3, true).every((step) => step.state === "done"));
  });
});

describe("account view", () => {
  it("hides the preview url in mock mode", () => {
    const user: SessionUser = { id: "u", email: "a@b.c", name: "A", provider: "google" };
    const box: Box = {
      id: "b",
      userId: "u",
      slug: "calm-otter",
      status: "running",
      hetznerServerId: null,
      hetznerFirewallId: null,
      ipv4: null,
      region: "fsn1",
      appPort: 3000,
      stripeSubscriptionId: null,
      dnsRecordId: null,
      provisionTokenHash: null,
      error: null,
      githubClone: null,
      createdAt: new Date().toISOString(),
      readyAt: new Date().toISOString(),
      destroyedAt: null,
      lastSyncAt: null,
      backupEnabled: false,
      serverType: null,
      hostname: null,
    };
    const view = toAccountView({ mock: true, domain: "chillrig.test", user, subscription: null, box });
    assert.equal(view.previewUrl, null);
    assert.equal(view.box?.hostname, "calm-otter.chillrig.test");
    assert.equal(sslipHostname("1.2.3.4"), "1-2-3-4.sslip.io");
    assert.equal(sslipHostname("256.1.1.1"), null);
    assert.equal(sslipHostname("not-an-ip"), null);
    assert.equal(boxHostname({ hostname: "1-2-3-4.sslip.io", slug: "calm-otter" }, "chillrig.test"), "1-2-3-4.sslip.io");
    assert.equal(boxHostname({ hostname: null, slug: "calm-otter" }, "chillrig.test"), "calm-otter.chillrig.test");
    assert.match(readFileSync("install.sh", "utf8"), /CHILLRIG_SSLIP/);
    assert.match(readFileSync("install.sh", "utf8"), /sslip\.io/);
    assert.ok(view.steps.every((step) => step.state === "done"));
  });
});

describe("install script", () => {
  it("keeps ttyd private and does not collect provider tokens", () => {
    // The terminal and agent units moved to update.sh, which install.sh runs.
    const script = readFileSync("install.sh", "utf8") + readFileSync("public/box/update.sh", "utf8");
    assert.match(script, /127\.0\.0\.1/);
    assert.match(script, /forward_auth/);
    assert.match(script, /-W/);
    assert.match(script, /X-Chillrig-Auth/);
    assert.match(script, /PasswordAuthentication no/);
    assert.doesNotMatch(script, /setup-token/);
    assert.doesNotMatch(script, /hash-password[\s\S]{0,120}sed/);
    assert.match(script, /CHILLRIG_BASIC_HASH/);
    assert.match(script, /tmux new-session -d -s chillrig/);
    assert.match(script, /shred -u/);
    assert.match(script, /22\/tcp/);
    assert.match(script, /enable-tls\.sh/);
    assert.match(script, /conntrack --ctstate ESTABLISHED,RELATED/);
    assert.ok(script.indexOf("ufw allow 22/tcp") < script.indexOf("ufw --force enable"));
    assert.ok(script.indexOf("ufw allow 22/tcp") < script.indexOf("ufw default deny incoming"));
    const defaults = placementPlan();
    assert.deepEqual([...new Set(defaults.map((item) => item.serverType))], ["cx33", "cax21", "cx23", "cax11", "cpx12"]);
    assert.equal(placementPlan({ types: "cpx32,cx33", maxMonthlyEur: 12 }).every((item) => item.serverType === "cx33"), true);
    assert.equal(placementPlan({ types: "cpx32", maxMonthlyEur: 12 }).length, 0);
    const plan = placementPlan({
      types: "cx33,cax21,cpx32,cx23",
      locations: "fsn1,nbg1,hel1",
      preferredLocation: "fsn1",
      maxMonthlyEur: 12,
    });
    assert.deepEqual(
      plan.slice(0, 3).map((item) => `${item.serverType}@${item.location}`),
      ["cx33@fsn1", "cx33@nbg1", "cx33@hel1"],
    );
    assert.equal(plan[3]?.serverType, "cax21");
    assert.deepEqual(
      plan.slice(-3).map((item) => item.serverType),
      ["cx23", "cx23", "cx23"],
    );
    assert.equal(placementPlan({ preferredLocation: "hel1" })[0]?.location, "hel1");
    // The cap covers the whole bill: IPv4 always, backups when on.
    const withBackups = [...new Set(placementPlan({ maxMonthlyEur: 12, backups: true }).map((item) => item.serverType))];
    assert.deepEqual(withBackups, ["cx33", "cx23", "cax11"]);
    assert.ok(placementPlan({ maxMonthlyEur: 12, backups: true }).every((item) => effectiveMonthlyEur(item.spec!, true) <= 12));
    assert.equal(placementPlan({ types: "cax21", maxMonthlyEur: 11.4 }).length, 0);
    assert.equal(effectiveMonthlyEur({ monthlyEur: 10.99 }, true), 10.99 * 1.2 + 0.5);
    assert.equal(isPricierThanPlan(8.99), false);
    assert.equal(isPricierThanPlan(10.99), true);
    assert.equal(isPricierThanPlan(5.99), false);
    const primary = plan[0];
    assert.ok(primary);
    assert.equal(fallbackNotice(primary, primary), null);
    assert.match(fallbackNotice(plan[3]!, primary) ?? "", /pricier than the €8.49/);
    assert.doesNotMatch(fallbackNotice(plan.at(-1)!, primary) ?? "", /pricier/);
    assert.equal(PLAN_MONTHLY_EUR, 8.49);
    const stock = new Map([["cx33", new Set<string>()], ["cax11", new Set(["hel1"])]]);
    assert.deepEqual(
      inStock(placementPlan(), stock).map((item) => `${item.serverType}@${item.location}`),
      ["cax11@hel1"],
    );
    assert.equal(inStock(placementPlan(), null).length, placementPlan().length);
    assert.equal(subscriptionAllowsBox("past_due"), true);
    assert.equal(subscriptionAllowsBox("active"), true);
    assert.equal(subscriptionAllowsBox("canceled"), false);
    assert.equal(subscriptionEndsBox("unpaid"), true);
    assert.equal(subscriptionEndsBox("past_due"), false);
    assert.equal(subscriptionEndsBox("canceled"), true);
    assert.doesNotMatch(readFileSync("components/mock-terminal.tsx", "utf8"), /fetch\(|WebSocket|setup-token/);
    assert.doesNotMatch(readFileSync("components/live-terminal.tsx", "utf8"), /console\.(log|debug|info|trace)/);
    const userData = renderUserData({
      CHILLRIG_DOMAIN: "calm-otter.chillrig.test",
      CHILLRIG_READY_TOKEN: "abc'def",
      CHILLRIG_CLOSE_SSH: "1",
    });
    assert.ok(userData.startsWith("#!/bin/bash\n"));
    assert.match(userData, /CHILLRIG_READY_TOKEN='abc'\\''def'/);
    assert.ok(Buffer.byteLength(userData) < 32_000);
  });
});
