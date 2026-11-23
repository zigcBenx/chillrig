import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { previewHref } from "../lib/box-client";
import {
  NO_COMMAND,
  previewCommand,
  previewCookie,
  previewPage,
  previewSnippet,
  pruneKeys,
  readCookies,
  safeNext,
  snippetIsPublic,
  taskPrompt,
  validKey,
} from "../public/box/preview.mjs";

const files = ["package.json", "node_modules", "app"];

describe("preview start command", () => {
  it("uses the dev script with the flags each framework understands", () => {
    const next = previewCommand({ pkg: { scripts: { dev: "next dev --turbopack" } }, files, port: 3000 });
    assert.deepEqual(next?.command, ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]);
    assert.equal(next?.install, false);
    assert.equal(next?.label, "npm run dev -- -H 0.0.0.0 -p 3000");
    assert.equal(next?.env.PORT, "3000");
    assert.equal(next?.env.HOST, "0.0.0.0");
    assert.equal(next?.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, undefined);
    const behindCaddy = previewCommand({ pkg: { scripts: { dev: "vite" } }, files, port: 3000, host: "1-2-3-4.sslip.io" });
    assert.equal(behindCaddy?.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, "1-2-3-4.sslip.io");

    const vite = previewCommand({ pkg: { scripts: { dev: "vite" } }, files, port: 3001 });
    assert.deepEqual(vite?.command, ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3001", "--strictPort"]);
    const svelte = previewCommand({ pkg: { scripts: { dev: "vite dev" } }, files, port: 3000 });
    assert.equal(svelte?.command.includes("--strictPort"), true);
    const astro = previewCommand({ pkg: { scripts: { dev: "astro dev" } }, files, port: 3000 });
    assert.deepEqual(astro?.command.slice(4), ["--host", "0.0.0.0", "--port", "3000"]);
    const nuxt = previewCommand({ pkg: { scripts: { dev: "nuxt dev" } }, files, port: 3000 });
    assert.deepEqual(nuxt?.command.slice(4), ["--host", "0.0.0.0", "--port", "3000"]);
  });

  it("runs an unknown dev script as it is, with PORT and HOST set", () => {
    const custom = previewCommand({ pkg: { scripts: { dev: "node server.js" } }, files, port: 3000 });
    assert.deepEqual(custom?.command, ["npm", "run", "dev"]);
    assert.equal(custom?.env.PORT, "3000");
  });

  it("falls back to the framework a project depends on, then npm start, then a static page", () => {
    const next = previewCommand({ pkg: { dependencies: { next: "16", react: "19" } }, files, port: 3000 });
    assert.deepEqual(next?.command, ["npx", "--no", "next", "dev", "-H", "0.0.0.0", "-p", "3000"]);
    const vite = previewCommand({ pkg: { devDependencies: { vite: "7" } }, files, port: 3000 });
    assert.deepEqual(vite?.command, ["npx", "--no", "vite", "--host", "0.0.0.0", "--port", "3000", "--strictPort"]);
    const start = previewCommand({ pkg: { scripts: { start: "node index.js" } }, files, port: 3000 });
    assert.deepEqual(start?.command, ["npm", "start"]);
    const page = previewCommand({ pkg: null, files: ["index.html", "style.css"], port: 3000 });
    assert.deepEqual(page?.command, ["python3", "-m", "http.server", "3000", "--bind", "0.0.0.0"]);
    assert.equal(page?.install, false);
  });

  it("installs packages first when node_modules is missing", () => {
    const fresh = previewCommand({ pkg: { scripts: { dev: "next dev" } }, files: ["package.json"], port: 3000 });
    assert.equal(fresh?.install, true);
  });

  it("returns null when there is nothing it knows how to start", () => {
    assert.equal(previewCommand({ pkg: null, files: ["README.md"], port: 3000 }), null);
    assert.equal(previewCommand({ pkg: { scripts: { test: "x" } }, files, port: 3000 }), null);
    assert.equal(previewCommand({ pkg: { scripts: { dev: "   " } }, files, port: 3000 }), null);
    assert.match(NO_COMMAND, /dev script/);
  });
});

describe("preview access", () => {
  it("is private unless the file is exactly the public snippet", () => {
    assert.equal(snippetIsPublic(previewSnippet(true)), true);
    assert.equal(snippetIsPublic(previewSnippet(false)), false);
    assert.equal(snippetIsPublic(""), false);
    assert.equal(snippetIsPublic(undefined), false);
    assert.equal(snippetIsPublic(`${previewSnippet(true)}forward_auth x\n`), false);
    assert.match(previewSnippet(false), /forward_auth 127\.0\.0\.1:7682 \{\n\turi \/_chillrig\/preview\/check\n\}/);
    assert.doesNotMatch(previewSnippet(true), /forward_auth|reverse_proxy/);
  });

  it("writes the same private default in update.sh as the agent does", () => {
    const update = readFileSync("public/box/update.sh", "utf8");
    const written = update.match(/cat > "\$\{tmp\}\/preview\.caddy" << 'EOF'\n([\s\S]*?)EOF\n/)?.[1];
    assert.equal(written, previewSnippet(false));
  });

  it("reads every preview cookie and accepts only well-formed keys", () => {
    const key = "a".repeat(43);
    assert.deepEqual(readCookies(`x=1; chillrig_preview=${key}; chillrig_preview=old`, "chillrig_preview"), [key, "old"]);
    assert.deepEqual(readCookies(undefined, "chillrig_preview"), []);
    assert.deepEqual(readCookies("chillrig_previewx=1", "chillrig_preview"), []);
    assert.equal(validKey(key), true);
    assert.equal(validKey(`${key}=`), false);
    assert.equal(validKey("short"), false);
  });

  it("sets a Lax cookie for a tab and a partitioned None cookie for a frame", () => {
    assert.equal(previewCookie("k"), "chillrig_preview=k; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax");
    assert.equal(previewCookie("k", { frame: true }), "chillrig_preview=k; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=None; Partitioned");
  });

  it("only redirects to paths on the box itself", () => {
    assert.equal(safeNext("/about?x=1"), "/about?x=1");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "about", "", null, "/a\nb", "/_chillrig/status", "/ttyd/"]) {
      assert.equal(safeNext(bad), "/", String(bad));
    }
  });

  it("keeps the newest unexpired keys", () => {
    const hash = (n: number) => n.toString(16).padStart(64, "0");
    const now = 1_000_000;
    const keys = [
      { hash: hash(1), exp: now - 1 },
      { hash: hash(2), exp: now + 10 },
      { hash: hash(3), exp: now + 30 },
      { hash: hash(4), exp: now + 20 },
      { hash: "nope", exp: now + 50 },
    ];
    assert.deepEqual(
      pruneKeys(keys, now, 2).map((key) => key.hash),
      [hash(4), hash(3)],
    );
    assert.deepEqual(pruneKeys("bad", now), []);
  });

  it("escapes the waiting page", () => {
    const html = previewPage({ title: "<b>x</b>", message: 'say "hi" & go', refresh: 2 });
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /say &quot;hi&quot; &amp; go/);
    assert.match(html, /http-equiv="refresh" content="2"/);
    assert.doesNotMatch(previewPage({ title: "t", message: "m" }), /refresh/);
  });

  it("links to the control plane, which sends the browser on to the box", () => {
    assert.equal(previewHref(), "/api/boxes/preview");
    assert.equal(previewHref("tes-chillrig"), "/api/boxes/preview?project=tes-chillrig");
    assert.equal(previewHref("../etc"), "/api/boxes/preview");
  });
});

describe("task prompt note", () => {
  it("keeps the prompt as typed and adds where the preview lives", () => {
    const prompt = 'simple page that just have text saying "Hello this is ChillRig test"';
    const full = taskPrompt(prompt, { port: 3000, host: "178-105-249-241.sslip.io", label: "npm run dev -- -H 0.0.0.0 -p 3000" });
    assert.ok(full.startsWith(`${prompt}\n\n(Chillrig:`));
    assert.match(full, /https:\/\/178-105-249-241\.sslip\.io\//);
    assert.match(full, /0\.0\.0\.0:3000/);
    assert.match(full, /`npm run dev -- -H 0\.0\.0\.0 -p 3000`/);
    assert.match(full, /curl -sI http:\/\/127\.0\.0\.1:3000/);
    assert.match(full, /Next\.js allowedDevOrigins, Vite server\.allowedHosts\), allow 178-105-249-241\.sslip\.io\.\)$/);
    const generic = taskPrompt("x", { port: 3002, host: null });
    assert.match(generic, /this box's web address/);
    assert.match(generic, /npm run dev -- -H 0\.0\.0\.0 -p 3002/);
  });
});
