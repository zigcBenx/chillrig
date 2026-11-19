import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderUserData } from "../lib/cloud-init";
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
    };
    const view = toAccountView({ mock: true, domain: "chillrig.test", user, subscription: null, box });
    assert.equal(view.previewUrl, null);
    assert.equal(view.box?.hostname, "calm-otter.chillrig.test");
    assert.ok(view.steps.every((step) => step.state === "done"));
  });
});

describe("install script", () => {
  it("keeps ttyd private and does not collect provider tokens", () => {
    const script = readFileSync("install.sh", "utf8");
    assert.match(script, /127\.0\.0\.1/);
    assert.match(script, /forward_auth/);
    assert.match(script, /-W/);
    assert.match(script, /X-Chillrig-Auth/);
    assert.match(script, /PasswordAuthentication no/);
    assert.doesNotMatch(script, /setup-token/);
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
