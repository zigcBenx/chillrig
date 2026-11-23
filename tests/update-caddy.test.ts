// Runs update.sh's migrate_caddy against real Caddy (validate) on files shaped like a
// box that was set up before preview protection: https on sslip.io, port 3000.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { previewSnippet } from "../public/box/preview.mjs";
import { caddyBinary } from "./helpers/caddy";

const update = readFileSync("public/box/update.sh", "utf8");
const install = readFileSync("install.sh", "utf8");
const newBody = install.match(/routes_body=\$\(cat << 'EOF'\n([\s\S]*?)\nEOF\n\)/)?.[1] ?? "";
const NEW_BLOCK = newBody.slice(newBody.indexOf("\thandle {\n\t\timport /etc/chillrig/preview.caddy"));
const OLD_BLOCK = "\thandle {\n\t\treverse_proxy 127.0.0.1:__APP_PORT__\n\t}";
// What install.sh wrote before agent v4.
const oldBody = newBody.replace(NEW_BLOCK, OLD_BLOCK);

const migration =
  (update.match(/^read -r -d '' MIGRATE_CADDY << 'JS' \|\| true\n[\s\S]*?\nJS\n/m)?.[0] ?? "") +
  (update.match(/^migrate_caddy\(\) \{\n[\s\S]*?\n\}\n/m)?.[0] ?? "");

const https = (body: string) => `{\n\temail admin@1-2-3-4.sslip.io\n}\n\n1-2-3-4.sslip.io {\n${body}\n}\n`;
const http = (body: string) => `:80 {\n${body}\n}\n`;

async function box({ reloadFails = false, preview = previewSnippet(false), active = https(oldBody) } = {}) {
  const caddy = await caddyBinary();
  const root = mkdtempSync(path.join(tmpdir(), "chillrig-migrate-"));
  const etc = path.join(root, "etc");
  const live = path.join(root, "caddy");
  const bin = path.join(root, "bin");
  for (const dir of [etc, live, bin]) mkdirSync(dir);
  const local = (text: string) => text.replaceAll("/etc/chillrig/", `${etc}/`);
  writeFileSync(path.join(etc, "auth.caddy"), "forward_auth https://chillrig.example.dev {\n\turi /api/terminal/verify\n}\n");
  writeFileSync(path.join(etc, "preview.caddy"), preview);
  writeFileSync(path.join(etc, "app_port"), "3000");
  writeFileSync(path.join(etc, "Caddyfile.http.tmpl"), local(http(oldBody)));
  writeFileSync(path.join(etc, "Caddyfile.https.tmpl"), local(https(oldBody)));
  writeFileSync(path.join(etc, "Caddyfile.tmpl"), local(active));
  writeFileSync(path.join(live, "Caddyfile"), local(active).replaceAll("__APP_PORT__", "3000"));
  // Real `caddy validate`; `caddy reload` and systemctl are stand-ins.
  writeFileSync(path.join(bin, "caddy"), `#!/bin/bash\nif [[ "$1" == reload ]]; then echo "$@" >> "${root}/reloads"; exit ${reloadFails ? 1 : 0}; fi\nexec "${caddy}" "$@"\n`);
  writeFileSync(path.join(bin, "systemctl"), "#!/bin/bash\nexit 0\n");
  chmodSync(path.join(bin, "caddy"), 0o755);
  chmodSync(path.join(bin, "systemctl"), 0o755);
  const snapshot = () => ({
    http: readFileSync(path.join(etc, "Caddyfile.http.tmpl"), "utf8"),
    https: readFileSync(path.join(etc, "Caddyfile.https.tmpl"), "utf8"),
    active: readFileSync(path.join(etc, "Caddyfile.tmpl"), "utf8"),
    live: readFileSync(path.join(live, "Caddyfile"), "utf8"),
  });
  const run = () => {
    const script = ["set -euo pipefail", migration.replaceAll("/etc/chillrig", etc).replaceAll("/etc/caddy", live), "migrate_caddy"].join("\n");
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  return { root, etc, local, live: path.join(live, "Caddyfile"), snapshot, run, reloads: () => (existsSync(path.join(root, "reloads")) ? readFileSync(path.join(root, "reloads"), "utf8") : "") };
}

describe("update.sh Caddy migration", () => {
  it("finds the migration and the install.sh block it adds", () => {
    assert.ok(migration.includes("migrate_caddy() {"));
    assert.ok(NEW_BLOCK.includes("handle_errors 502 503 504"));
    assert.notEqual(oldBody, newBody);
  });

  it("adds preview auth, keeps domain, email, port and auth, reloads once, and is a no-op the second time", async () => {
    const rig = await box();
    try {
      const before = rig.snapshot();
      assert.match(rig.run(), /private now/);
      const after = rig.snapshot();
      // Exactly what a fresh install writes, with everything else as it was.
      assert.equal(after.https, rig.local(https(newBody)));
      assert.equal(after.http, rig.local(http(newBody)));
      assert.equal(after.active, rig.local(https(newBody)));
      assert.equal(after.live, rig.local(https(newBody)).replaceAll("__APP_PORT__", "3000"));
      assert.match(after.live, /email admin@1-2-3-4\.sslip\.io/);
      assert.match(after.live, /^1-2-3-4\.sslip\.io \{$/m);
      assert.match(after.live, /reverse_proxy 127\.0\.0\.1:3000/);
      assert.equal((after.live.match(/auth\.caddy/g) ?? []).length, 2);
      assert.equal(readFileSync(`${rig.live}.chillrig-bak`, "utf8"), before.live);
      assert.equal(readFileSync(path.join(rig.etc, "Caddyfile.https.tmpl.chillrig-bak"), "utf8"), before.https);
      assert.equal(rig.reloads().trim().split("\n").length, 1);

      assert.equal(rig.run(), "");
      assert.deepEqual(rig.snapshot(), after);
      assert.equal(rig.reloads().trim().split("\n").length, 1);
    } finally {
      rmSync(rig.root, { recursive: true, force: true });
    }
  });

  it("finishes a template that an earlier run missed, even when the live file is current", async () => {
    const rig = await box({ active: https(newBody) });
    try {
      assert.match(rig.run(), /private now/);
      const after = rig.snapshot();
      assert.equal(after.http, rig.local(http(newBody)));
      assert.equal(after.https, rig.local(https(newBody)));
      assert.equal(existsSync(path.join(rig.etc, "Caddyfile.http.tmpl.chillrig-new")), false);
      assert.equal(rig.run(), "");
    } finally {
      rmSync(rig.root, { recursive: true, force: true });
    }
  });

  it("puts every file back when Caddy refuses the reload", async () => {
    const rig = await box({ reloadFails: true });
    try {
      const before = rig.snapshot();
      assert.match(rig.run(), /putting the old one back/);
      assert.deepEqual(rig.snapshot(), before);
    } finally {
      rmSync(rig.root, { recursive: true, force: true });
    }
  });

  it("changes nothing when the new config does not validate", async () => {
    const rig = await box({ preview: "this is not a directive {\n" });
    try {
      const before = rig.snapshot();
      assert.match(rig.run(), /did not validate/);
      assert.deepEqual(rig.snapshot(), before);
      assert.equal(rig.reloads(), "");
      assert.equal(existsSync(path.join(rig.etc, "Caddyfile.tmpl.chillrig-new")), false);
    } finally {
      rmSync(rig.root, { recursive: true, force: true });
    }
  });

  it("leaves templates it does not recognise alone", async () => {
    const custom = https(oldBody).replace(OLD_BLOCK, "\thandle {\n\t\trespond \"custom\"\n\t}");
    const rig = await box({ active: custom });
    try {
      const before = rig.snapshot();
      assert.match(rig.run(), /left them as they are/);
      assert.deepEqual(rig.snapshot(), before);
      assert.equal(rig.reloads(), "");
    } finally {
      rmSync(rig.root, { recursive: true, force: true });
    }
  });
});
