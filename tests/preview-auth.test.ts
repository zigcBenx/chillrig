// Boots Caddy with the site body install.sh writes, the real box agent and a stub app,
// then checks who can reach the app preview, the agent and the terminal.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, request, type Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { previewSnippet } from "../public/box/preview.mjs";
import { caddyBinary, freePort, waitForStatus } from "./helpers/caddy";

const install = readFileSync("install.sh", "utf8");
const routesBody = install.match(/routes_body=\$\(cat << 'EOF'\n([\s\S]*?)\nEOF\n\)/)?.[1] ?? "";
const managedAuth = install.match(/cat > \/etc\/chillrig\/auth\.caddy << EOF\n([\s\S]*?)\nEOF\n/)?.[1] ?? "";

type Rig = {
  url: string;
  /** Writes preview.caddy the way the agent does and reloads Caddy. */
  setPublic: (value: boolean) => void;
  stopApp: () => Promise<void>;
  close: () => Promise<void>;
};

function listen(server: Server, port: number) {
  return new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
}

/** Caddy + agent + app. auth: what /etc/chillrig/auth.caddy holds; controlPlane: agent env. */
async function startRig({ auth, controlPlane }: { auth: (ports: { cp: number }) => string; controlPlane: (cp: number) => string }) {
  const caddy = await caddyBinary();
  const dir = mkdtempSync(path.join(tmpdir(), "chillrig-preview-"));
  const [site, admin, agentPort, appPort, cpPort, deadPort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort(), freePort()]);
  const configDir = path.join(dir, "etc");
  const stateDir = path.join(dir, "state");
  mkdirSync(configDir);
  mkdirSync(stateDir);
  mkdirSync(path.join(dir, "home", "projects"), { recursive: true });

  // The control plane's ticket check: only "good-ticket" passes.
  const cp = createServer((req, res) => {
    const ok = req.url?.startsWith("/api/terminal/verify") && req.headers["x-chillrig-ticket"] === "good-ticket";
    res.writeHead(ok ? 200 : 401);
    res.end();
  });
  await listen(cp, cpPort);
  const app = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("app ok");
  });
  await listen(app, appPort);

  const local = (text: string) =>
    text
      .replaceAll("127.0.0.1:7682", `127.0.0.1:${agentPort}`)
      .replaceAll("127.0.0.1:7681", `127.0.0.1:${deadPort}`)
      .replaceAll("/etc/chillrig/", `${configDir}/`)
      .replaceAll("__APP_PORT__", String(appPort));
  const previewFile = path.join(configDir, "preview.caddy");
  writeFileSync(path.join(configDir, "auth.caddy"), auth({ cp: cpPort }));
  writeFileSync(previewFile, local(previewSnippet(false)));
  const config = path.join(dir, "Caddyfile");
  writeFileSync(config, `{\n\tadmin 127.0.0.1:${admin}\n\tauto_https off\n}\n:${site} {\n${local(routesBody)}\n}\n`);

  const tmuxSocket = `chillrig-test-${process.pid}-${site}`;
  const agent: ChildProcess = spawn(process.execPath, ["public/box/agent.mjs"], {
    stdio: "ignore",
    env: {
      ...process.env,
      CHILLRIG_AGENT_PORT: String(agentPort),
      CHILLRIG_CONFIG_DIR: configDir,
      CHILLRIG_STATE_DIR: stateDir,
      CHILLRIG_HOME: path.join(dir, "home"),
      CHILLRIG_USER: userInfo().username,
      CHILLRIG_TMUX_SOCKET: tmuxSocket,
      CHILLRIG_CONTROL_PLANE: controlPlane(cpPort),
    },
  });
  const server: ChildProcess = spawn(caddy, ["run", "--config", config], { stdio: "ignore" });
  const url = `http://127.0.0.1:${site}`;
  await waitForStatus(`${url}/_chillrig/health`, (status) => status === 200 || status === 503);

  return {
    url,
    setPublic: (value: boolean) => {
      writeFileSync(previewFile, value ? previewSnippet(true) : local(previewSnippet(false)));
      const result = spawnSync(caddy, ["reload", "--config", config, "--address", `127.0.0.1:${admin}`], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    },
    stopApp: () => new Promise<void>((resolve) => app.close(() => resolve())),
    close: async () => {
      server.kill("SIGTERM");
      agent.kill("SIGTERM");
      cp.close();
      app.close();
      spawnSync("tmux", ["-L", tmuxSocket, "kill-server"]);
      rmSync(dir, { recursive: true, force: true });
    },
  } satisfies Rig;
}

const navigate = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", accept: "text/html" };

// node:http, not fetch: fetch sends its own Sec-Fetch-Mode, which would hide a navigation.
function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Headers; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const out = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) out.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve({ status: res.statusCode ?? 0, headers: out, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function cookieFrom(setCookie: string | null) {
  const value = setCookie?.match(/^chillrig_preview=([^;]+)/)?.[1];
  assert.ok(value, `no preview cookie in ${setCookie}`);
  return `chillrig_preview=${value}`;
}

describe("app preview auth (managed box)", () => {
  let rig: Rig;
  before(async () => {
    assert.ok(routesBody.includes("import /etc/chillrig/preview.caddy"), "install.sh routes_body not found");
    rig = await startRig({
      auth: ({ cp }) => managedAuth.replaceAll("${CHILLRIG_CONTROL_PLANE}", `http://127.0.0.1:${cp}`),
      controlPlane: () => "https://chillrig.example.dev",
    });
  });
  after(async () => {
    await rig?.close();
  });

  it("keeps health public and the agent and terminal behind the ticket", async () => {
    const health = await get(`${rig.url}/_chillrig/health`);
    assert.notEqual(health.status, 401);
    assert.equal(JSON.parse(health.body).version, 4);
    assert.equal((await get(`${rig.url}/_chillrig/status`)).status, 401);
    assert.equal((await get(`${rig.url}/ttyd/`)).status, 401);
  });

  it("rejects the private preview without a cookie and sends the owner to sign in", async () => {
    const plain = await get(`${rig.url}/`);
    assert.equal(plain.status, 401);
    assert.doesNotMatch(plain.body, /app ok/);
    const page = await get(`${rig.url}/about?x=1`, navigate);
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "https://chillrig.example.dev/api/boxes/preview?next=%2Fabout%3Fx%3D1");
  });

  it("enters only with a valid ticket, then the cookie alone opens the app", async () => {
    const bad = await get(`${rig.url}/_chillrig/preview/enter?ticket=nope`);
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get("set-cookie"), null);

    const enter = await get(`${rig.url}/_chillrig/preview/enter?ticket=good-ticket&next=%2Fhello`, navigate);
    assert.equal(enter.status, 303);
    assert.equal(enter.headers.get("location"), "/hello");
    const setCookie = enter.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\//);
    const cookie = cookieFrom(setCookie);

    const ok = await get(`${rig.url}/`, { cookie });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, "app ok");
    // An app request can carry any Origin; the check must not care.
    assert.equal((await get(`${rig.url}/api/x`, { cookie, origin: "https://elsewhere.example" })).status, 200);

    const forged = await get(`${rig.url}/`, { cookie: `chillrig_preview=${"A".repeat(43)}` });
    assert.equal(forged.status, 401);
    // The preview cookie never opens the agent or the terminal.
    assert.equal((await get(`${rig.url}/_chillrig/status`, { cookie })).status, 401);
    assert.equal((await get(`${rig.url}/ttyd/`, { cookie })).status, 401);
    // An open redirect is not possible.
    const away = await get(`${rig.url}/_chillrig/preview/enter?ticket=good-ticket&next=%2F%2Fevil.example`);
    assert.equal(away.headers.get("location"), "/");
  });

  it("sets a partitioned SameSite=None cookie inside a frame", async () => {
    const framed = await get(`${rig.url}/_chillrig/preview/enter?ticket=good-ticket`, { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" });
    const setCookie = framed.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /SameSite=None/);
    assert.match(setCookie, /Partitioned/);
    assert.match(setCookie, /Secure/);
    assert.equal((await get(`${rig.url}/`, { cookie: cookieFrom(setCookie) })).status, 200);
  });

  it("opens to everyone when public, and closes again", async () => {
    rig.setPublic(true);
    const open = await get(`${rig.url}/`);
    assert.equal(open.status, 200);
    assert.equal(open.body, "app ok");
    assert.equal((await get(`${rig.url}/_chillrig/status`)).status, 401);
    assert.equal((await get(`${rig.url}/ttyd/`)).status, 401);

    rig.setPublic(false);
    assert.equal((await get(`${rig.url}/`)).status, 401);
  });

  it("shows the waiting page, not a bare error, while the app is down", async () => {
    const enter = await get(`${rig.url}/_chillrig/preview/enter?ticket=good-ticket`);
    const cookie = cookieFrom(enter.headers.get("set-cookie"));
    await rig.stopApp();
    const waiting = await get(`${rig.url}/`, { cookie });
    assert.equal(waiting.status, 503);
    assert.match(waiting.headers.get("content-type") ?? "", /text\/html/);
    assert.match(waiting.body, /Nothing to preview yet/);
    // Without the cookie the private preview still says no, app up or not.
    assert.equal((await get(`${rig.url}/`)).status, 401);
  });
});

describe("app preview auth (self-hosted box)", () => {
  let rig: Rig;
  const password = "correct-horse";
  before(async () => {
    const caddy = await caddyBinary();
    const hashed = spawnSync(caddy, ["hash-password", "--plaintext", password], { encoding: "utf8" });
    assert.equal(hashed.status, 0, hashed.stderr);
    rig = await startRig({ auth: () => `basic_auth {\n\tcoder ${hashed.stdout.trim()}\n}\n`, controlPlane: () => "" });
  });
  after(async () => {
    await rig?.close();
  });

  it("protects the preview with the same basic auth, then a cookie", async () => {
    assert.equal((await get(`${rig.url}/`)).status, 401);
    const page = await get(`${rig.url}/`, navigate);
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/_chillrig/preview/enter?next=%2F");
    assert.equal((await get(`${rig.url}/_chillrig/preview/enter`)).status, 401);
    const basic = { authorization: `Basic ${Buffer.from(`coder:${password}`).toString("base64")}` };
    const enter = await get(`${rig.url}/_chillrig/preview/enter`, basic);
    assert.equal(enter.status, 303);
    const ok = await get(`${rig.url}/`, { cookie: cookieFrom(enter.headers.get("set-cookie")) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, "app ok");
  });
});
