import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderUserData } from "../lib/cloud-init";
import { cleanCode } from "../lib/box-client";
import {
  EXIT_MARK,
  extractUrls,
  findClaudeUrl,
  findCodexDevice,
  parseClaudeStatus,
  parseGhUser,
  parseLogin,
  validateCode,
} from "../public/box/login-parse.mjs";

// Captured from `claude auth login --claudeai` (2.1.330) in a 250-column tmux pane.
const CLAUDE_WIDE = `Opening browser to sign in…
If the browser didn't open, visit:
https://claude.ai/oauth/authorize?z-kaiswEdVJZDLlfQmStJ86c9zoSBKqs9YgO-xg22F7HY
Paste code here if prompted >



`;

// The same output in a 40-column pane captured without -J: the URL is hard-wrapped.
const CLAUDE_WRAPPED = `Opening browser to sign in…
If the browser didn't open, visit:
https://claude.ai/oauth/authorize?z-sGbZ
9lxaHyj6J86xSPMb-oRLgNkaAFw08_yubXvVayE
Paste code here if prompted >
`;

// A longer, older-style URL wrapped over three lines.
const CLAUDE_LONG_WRAPPED = `Browser didn't open? Use the url below to sign in:

https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-59
44d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2
Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=abc123

Paste code here if prompted >
`;

const CLAUDE_REJECTED = `Opening browser to sign in…
If the browser didn't open, visit:
https://claude.ai/oauth/authorize?z-kaiswEdVJZDLlfQmStJ86c9zoSBKqs9YgO-xg22F7HY
Paste code here if prompted > bogus-code#state
Signing in…
Couldn't log in: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt. Sign in again to get a new code.

${EXIT_MARK}:1
`;

// Captured from `codex login --device-auth` (0.171.0).
const CODEX = `WARNING: proceeding, even though we could not create PATH aliases
Welcome to Codex [v0.171.0]
OpenAI's command-line coding agent
Follow these steps to sign in with ChatGPT using device code authorization:
1. Open this link in your browser and sign in to your account
   https://auth.openai.com/codex/device
2. Enter this one-time code (expires in 15 minutes)
   Y6ZH-H057L
Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.
`;

describe("login pane parsing", () => {
  it("finds the Claude OAuth URL, wide or wrapped", () => {
    const wide = "https://claude.ai/oauth/authorize?z-kaiswEdVJZDLlfQmStJ86c9zoSBKqs9YgO-xg22F7HY";
    assert.equal(findClaudeUrl(CLAUDE_WIDE), wide);
    assert.equal(findClaudeUrl(CLAUDE_WRAPPED), "https://claude.ai/oauth/authorize?z-sGbZ9lxaHyj6J86xSPMb-oRLgNkaAFw08_yubXvVayE");
    const long = findClaudeUrl(CLAUDE_LONG_WRAPPED);
    assert.ok(long?.endsWith("&state=abc123"));
    assert.ok(long?.includes("client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e"));
    assert.ok(long?.includes("console.anthropic.com%2Foauth%2Fcode%2Fcallback"));
  });

  it("strips ANSI codes and refuses non-Anthropic hosts", () => {
    assert.equal(findClaudeUrl("\x1b[94mhttps://claude.ai/oauth/authorize?x=1\x1b[39m\n"), "https://claude.ai/oauth/authorize?x=1");
    assert.equal(findClaudeUrl("https://evil.example/oauth/authorize?x=1\n"), null);
    assert.equal(findClaudeUrl("https://claude.ai.evil.example/oauth/authorize\n"), null);
    assert.equal(findClaudeUrl("http://claude.ai/oauth/authorize\n"), null);
    assert.deepEqual(extractUrls("see https://example.com/a.\nnext line"), ["https://example.com/a"]);
  });

  it("does not glue an indented line or a sentence onto a URL", () => {
    assert.deepEqual(extractUrls("   https://auth.openai.com/codex/device\n   Y6ZH-H057L\n"), ["https://auth.openai.com/codex/device"]);
    assert.deepEqual(extractUrls("https://claude.ai/oauth/authorize?a=1\nPaste code here >\n"), ["https://claude.ai/oauth/authorize?a=1"]);
  });

  it("reads the Codex device page and one-time code", () => {
    assert.deepEqual(findCodexDevice(CODEX), { url: "https://auth.openai.com/codex/device", code: "Y6ZH-H057L" });
    assert.deepEqual(parseLogin("codex", CODEX), { phase: "open_url", url: "https://auth.openai.com/codex/device", code: "Y6ZH-H057L" });
    assert.deepEqual(parseLogin("codex", "Welcome to Codex\n"), { phase: "starting" });
    assert.equal(parseLogin("codex", `${CODEX}\nSuccessfully logged in\n\n${EXIT_MARK}:0\n`).phase, "done");
    const failed = parseLogin("codex", `${CODEX}\nError logging in: device code expired\n${EXIT_MARK}:1\n`);
    assert.equal(failed.phase, "error");
    assert.match(failed.message ?? "", /expired/);
  });

  it("walks the Claude phases", () => {
    assert.deepEqual(parseLogin("claude", ""), { phase: "starting" });
    assert.deepEqual(parseLogin("claude", "Opening browser to sign in…\n"), { phase: "starting" });
    assert.equal(parseLogin("claude", CLAUDE_WIDE).phase, "waiting_code");
    assert.equal(parseLogin("claude", CLAUDE_WIDE, { codeSent: true }).phase, "verifying");
    assert.equal(parseLogin("claude", `${CLAUDE_WIDE}\nLogin successful.\n${EXIT_MARK}:0\n`, { codeSent: true }).phase, "done");
    const rejected = parseLogin("claude", CLAUDE_REJECTED, { codeSent: true });
    assert.equal(rejected.phase, "error");
    assert.match(rejected.message ?? "", /^Couldn't log in: That code wasn't accepted/);
    // The pasted code is echoed in the pane; it must never come back in the state.
    assert.doesNotMatch(JSON.stringify(rejected), /bogus-code/);
    assert.equal(parseLogin("claude", `${CLAUDE_WIDE}\n${EXIT_MARK}:130\n`).phase, "error");
  });

  it("clears an old error when the CLI prompts again", () => {
    const retried = `${CLAUDE_WIDE}\nInvalid code, try again\nPaste code here if prompted > \n`;
    assert.equal(parseLogin("claude", retried).phase, "waiting_code");
    assert.equal(parseLogin("claude", `${CLAUDE_WIDE}\nInvalid code\n`).phase, "error");
  });
});

describe("sign-in code validation", () => {
  it("accepts one printable token and rejects the rest", () => {
    assert.equal(validateCode("  abcDEF123_-#state.xyz  "), "abcDEF123_-#state.xyz");
    assert.equal(validateCode("-starts-with-dash"), "-starts-with-dash");
    assert.equal(validateCode(""), null);
    assert.equal(validateCode("   "), null);
    assert.equal(validateCode("a\nb"), null);
    assert.equal(validateCode("a b"), null);
    assert.equal(validateCode("a\tb"), null);
    assert.equal(validateCode("a\u001bb"), null);
    assert.equal(validateCode("a\u2028b"), null);
    assert.equal(validateCode("x".repeat(400)), "x".repeat(400));
    assert.equal(validateCode("x".repeat(401)), null);
    assert.equal(validateCode(42), null);
    assert.equal(validateCode(undefined), null);
    assert.equal(cleanCode(" ok#1 "), "ok#1");
    assert.equal(cleanCode("a\nb"), null);
  });
});

describe("tool status parsing", () => {
  it("keeps only the fields the UI may show", () => {
    const status = parseClaudeStatus(
      JSON.stringify({ loggedIn: true, email: "a@b.c", subscriptionType: "max", accessToken: "sk-ant-secret", orgId: "o" }),
    );
    assert.deepEqual(status, { loggedIn: true, email: "a@b.c", plan: "max" });
    assert.deepEqual(parseClaudeStatus(JSON.stringify({ loggedIn: false, authMethod: "none" })), {
      loggedIn: false,
      email: undefined,
      plan: undefined,
    });
    assert.deepEqual(parseClaudeStatus("not json"), { loggedIn: false });
    assert.equal(parseGhUser("github.com\n  ✓ Logged in to github.com account octo-cat (keyring)\n  - Token: gho_****"), "octo-cat");
    assert.equal(parseGhUser("✓ Logged in to github.com as octocat (oauth_token)"), "octocat");
    assert.equal(parseGhUser("You are not logged into any GitHub hosts."), undefined);
  });
});

describe("box agent and update script", () => {
  const agent = readFileSync("public/box/agent.mjs", "utf8");
  const update = readFileSync("public/box/update.sh", "utf8");
  const install = readFileSync("install.sh", "utf8");

  it("spawns argument arrays, never a shell with user input, and never logs", () => {
    assert.match(agent, /AGENT_VERSION = 4/);
    assert.doesNotMatch(agent, /shell:\s*true/);
    assert.doesNotMatch(agent, /execSync|exec\(`|child_process"\)\.exec/);
    assert.doesNotMatch(agent, /console\.(log|info|debug|warn|error)/);
    assert.doesNotMatch(agent, /setup-token/);
    assert.match(agent, /"send-keys", "-t", login\.session, "-l", "--", code/);
    assert.match(agent, /claude auth login --claudeai/);
    assert.match(agent, /codex login --device-auth/);
    assert.match(agent, /access-control-allow-origin/);
  });

  it("keeps tmux sessions alive across agent and terminal restarts", () => {
    assert.match(update, /chillrig-tmux\.service/);
    assert.match(update, /tmux new-session -d -s chillrig/);
    assert.match(update, /exit-empty off/);
    assert.equal((update.match(/^KillMode=process$/gm) ?? []).length, 3);
    assert.doesNotMatch(update, /systemctl restart chillrig-tmux|kill-session|kill-server/);
    // Caddy changes only in migrate_caddy: validated first, rolled back if the reload fails.
    // It never rewrites the auth file, the firewall or anything in ~/projects.
    assert.doesNotMatch(update, /ufw|> *\/etc\/chillrig\/auth\.caddy|projects/);
    assert.ok(update.indexOf("caddy validate") < update.indexOf("caddy reload"));
    assert.match(update, /putting the old one back/);
    assert.ok(update.indexOf("systemctl restart chillrig-agent.service") < update.lastIndexOf("migrate_caddy"));
    assert.match(update, /node --check/);
    assert.match(install, /update\.sh/);
    assert.match(install, /CHILLRIG_UPDATE_NO_START=1/);
    assert.match(install, /systemctl start chillrig-tmux/);
    assert.doesNotMatch(install, /cat > \/opt\/chillrig\/agent\.mjs/);
  });

  it("fits a managed box's user_data in Hetzner's 32KB", () => {
    const userData = renderUserData({
      CHILLRIG_SSLIP: "1",
      CHILLRIG_CONTROL_PLANE: "https://chillrig.example.workers.dev",
      CHILLRIG_ACME_EMAIL: "admin@sslip.io",
      CHILLRIG_READY_URL: "https://chillrig.example.workers.dev/api/boxes/ready",
      CHILLRIG_READY_TOKEN: "x".repeat(400),
      CHILLRIG_APP_PORT: "3000",
      CHILLRIG_SLUG: "calm-otter",
      CHILLRIG_CLOSE_SSH: "1",
    });
    assert.ok(Buffer.byteLength(userData) < 32_000, `user_data is ${Buffer.byteLength(userData)} bytes`);
  });
});

describe("update.sh env_get on a fresh box", () => {
  const update = readFileSync("public/box/update.sh", "utf8");
  const envGet = update.match(/^env_get\(\) \{\n[\s\S]*?\n\}$/m)?.[0];

  // Runs env_get under the same strict mode as update.sh, pointed at envFile.
  function run(envFile: string) {
    assert.ok(envGet, "env_get() not found in update.sh");
    const script = [
      "set -euo pipefail",
      envGet.replaceAll("/etc/chillrig/env", envFile),
      'A="${A:-$(env_get CHILLRIG_ALLOWED_ORIGINS)}"',
      'B="${B:-$(env_get CHILLRIG_USER)}"',
      'printf "ok|%s|%s" "$A" "$B"',
    ].join("\n");
    return spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env } });
  }

  it("gives empty values and exit 0 when /etc/chillrig/env does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "chillrig-env-"));
    try {
      const result = run(join(dir, "missing"));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "ok||");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the last value of a key and gives empty for a missing key", () => {
    const dir = mkdtempSync(join(tmpdir(), "chillrig-env-"));
    try {
      const file = join(dir, "env");
      writeFileSync(file, "CHILLRIG_USER=old\nCHILLRIG_USER=coder\n");
      const result = run(file);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "ok||coder");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
