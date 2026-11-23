// Chillrig box agent. Runs as root on 127.0.0.1:7682 behind Caddy, which checks a
// control-plane ticket (forward_auth) for everything under /_chillrig except /health.
// No dependencies. update.sh installs it in /opt/chillrig next to login-parse.mjs.
//
// It never stores, logs or returns provider tokens. The login pane is read only to
// find the sign-in URL, the device code and the result, and only those go back.
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { parseClaudeStatus, parseGhUser, parseLogin, validateCode, EXIT_MARK } from "./login-parse.mjs";

export const AGENT_VERSION = 2;

const user = process.env.CHILLRIG_USER || "coder";
const home = process.env.CHILLRIG_HOME || `/home/${user}`;
const port = Number(process.env.CHILLRIG_AGENT_PORT) || 7682;
const controlPlane = (process.env.CHILLRIG_CONTROL_PLANE || "").replace(/\/$/, "");
const allowedOrigins = new Set(
  [controlPlane, ...(process.env.CHILLRIG_ALLOWED_ORIGINS || "").split(",")]
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean),
);
// As root (on a box), commands for the user run through runuser. Unprivileged
// (local testing) they run as the current user. CHILLRIG_TMUX_SOCKET isolates tests.
const isRoot = process.getuid?.() === 0;
const tmuxSocket = process.env.CHILLRIG_TMUX_SOCKET ? ["-L", process.env.CHILLRIG_TMUX_SOCKET] : [];
const MAIN_SESSION = "chillrig";
const LOGIN_TTL_MS = 30 * 60 * 1000;
const TOOLS = {
  claude: { bin: "claude", login: "claude auth login --claudeai" },
  codex: { bin: "codex", login: "codex login --device-auth" },
};

const userPath = [`${home}/.local/bin`, "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];
const userEnv = {
  HOME: home,
  USER: user,
  LOGNAME: user,
  SHELL: "/bin/bash",
  LANG: "C.UTF-8",
  PATH: userPath.join(":"),
  GIT_TERMINAL_PROMPT: "0",
  NO_COLOR: "1",
};

function send(res, code, body, origin) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

// The browser sends only "simple" requests (GET, or POST with a text/plain JSON body)
// with the ticket in the query string, so there is no preflight for Caddy to reject.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8000) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("json"));
      }
    });
    req.on("error", reject);
  });
}

/** Runs a command with an argument array (never a shell string) and a timeout. */
function exec(command, args, { timeoutMs = 15000, env = userEnv, cwd = home } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, { env, cwd: existsSync(cwd) ? cwd : "/", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return resolve({ code: -1, stdout, stderr });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 65536) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 65536) stderr += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Same as exec, as the box user. */
function asUser(command, args, options) {
  if (!isRoot) return exec(command, args, options);
  return exec("runuser", ["-u", user, "--", command, ...args], options);
}

function tmux(args, options) {
  return asUser("tmux", [...tmuxSocket, ...args], { timeoutMs: 8000, ...options });
}

async function run(command, args, options) {
  const result = await exec(command, args, options);
  if (result.code !== 0) throw new Error("command failed");
  return result;
}

function installed(bin) {
  return userPath.some((dir) => existsSync(`${dir}/${bin}`));
}

// The tmux server must live in chillrig-tmux.service, not in this agent's cgroup, so
// restarting the agent or ttyd never ends a session. Start it there when it is missing.
async function ensureTmuxServer() {
  if ((await tmux(["list-sessions"])).code === 0) return;
  if (isRoot && !tmuxSocket.length) {
    await exec("systemctl", ["restart", "chillrig-tmux.service"], { timeoutMs: 15000, env: process.env, cwd: "/" });
    if ((await tmux(["list-sessions"])).code === 0) return;
  }
  await tmux(["new-session", "-d", "-s", MAIN_SESSION, "-c", home]);
}

// ---- tool status, cached so polling stays cheap ----

const cache = new Map();
function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = load().catch(() => null);
  cache.set(key, { at: Date.now(), value });
  return value;
}
function forget(key) {
  cache.delete(key);
}

async function claudeStatus() {
  if (!installed("claude")) return { installed: false, loggedIn: false };
  const result = await asUser("claude", ["auth", "status", "--json"], { timeoutMs: 12000 });
  return { installed: true, ...parseClaudeStatus(result.stdout) };
}

async function codexStatus() {
  if (!installed("codex")) return { installed: false, loggedIn: false };
  const result = await asUser("codex", ["login", "status"], { timeoutMs: 12000 });
  return { installed: true, loggedIn: result.code === 0 };
}

async function ghStatus() {
  if (!installed("gh")) return { installed: false, loggedIn: false };
  const result = await asUser("gh", ["auth", "status", "--hostname", "github.com"], { timeoutMs: 12000 });
  const loggedIn = result.code === 0;
  return { installed: true, loggedIn, user: loggedIn ? parseGhUser(`${result.stdout}\n${result.stderr}`) : undefined };
}

function toolStatus(tool, fresh = false) {
  const ttl = fresh ? 1500 : login ? 2500 : 5000;
  if (tool === "claude") return cached("claude", ttl, claudeStatus);
  if (tool === "codex") return cached("codex", ttl, codexStatus);
  return cached("gh", 30000, ghStatus);
}

// ---- CLI login inside a dedicated tmux session ----

let login = null; // { tool, session, startedAt, wasLoggedIn, codeSent, final }

function sessionName(tool) {
  return `chillrig-login-${tool}`;
}

// The Claude CLI asks for a theme and shows a welcome on first run. Mark onboarding as
// done without touching anything else in the file. This runs as the user, never as
// root, so a symlinked ~/.claude.json cannot redirect a root write.
const SEED_CLAUDE = `
const fs = require("fs");
const path = require("os").homedir() + "/.claude.json";
let data = {};
try { data = JSON.parse(fs.readFileSync(path, "utf8")); } catch (e) { if (e.code !== "ENOENT") process.exit(0); }
if (!data || typeof data !== "object" || Array.isArray(data)) process.exit(0);
if (data.hasCompletedOnboarding === true && data.theme) process.exit(0);
data.hasCompletedOnboarding = true;
if (!data.theme) data.theme = "dark";
fs.writeFileSync(path + ".chillrig", JSON.stringify(data, null, 2), { mode: 0o600 });
fs.renameSync(path + ".chillrig", path);
`;

async function startLogin(tool) {
  const spec = TOOLS[tool];
  if (!installed(spec.bin)) return { error: `${tool === "claude" ? "Claude Code" : "Codex"} is not installed on this box`, status: 409 };
  await ensureTmuxServer();
  const before = await toolStatus(tool, true);
  if (login) await tmux(["kill-session", "-t", login.session]);
  const session = sessionName(tool);
  await tmux(["kill-session", "-t", session]);
  if (tool === "claude") await asUser(process.execPath, ["-e", SEED_CLAUDE], { timeoutMs: 8000 });
  // Wide window so the URL is printed on one line. The pane prints the exit code and
  // stays a while so the result can be read; the session ends itself after 30 minutes.
  const script = `${spec.login}; code=$?; echo; echo "${EXIT_MARK}:$code"; sleep 1800`;
  const created = await tmux(["new-session", "-d", "-s", session, "-x", "250", "-y", "50", "-c", home, "sh", "-c", script]);
  if (created.code !== 0) return { error: "Could not start the sign-in", status: 500 };
  login = { tool, session, startedAt: Date.now(), wasLoggedIn: Boolean(before?.loggedIn), codeSent: false, final: null };
  return { ok: true };
}

async function capture(session) {
  const result = await tmux(["capture-pane", "-p", "-J", "-S", "-200", "-t", session]);
  return result.code === 0 ? result.stdout : null;
}

async function loginState(statuses) {
  if (!login) return null;
  const { tool } = login;
  if (Date.now() - login.startedAt > LOGIN_TTL_MS) {
    await endLogin();
    return null;
  }
  if (login.final) {
    if (Date.now() - login.final.at > 120000) login = null;
    return login ? { tool, ...login.final.state } : null;
  }
  const pane = await capture(login.session);
  const parsed = pane === null ? { phase: "error", message: "Sign-in stopped. Try again." } : parseLogin(tool, pane, { codeSent: login.codeSent });
  let status = statuses[tool];
  if (parsed.phase === "done" || parsed.phase === "error" || parsed.phase === "verifying") {
    forget(tool);
    status = await toolStatus(tool, true);
  }
  const loggedInNow = Boolean(status?.loggedIn) && (!login.wasLoggedIn || parsed.phase === "done");
  if (loggedInNow) {
    login.final = { at: Date.now(), state: { phase: "done" } };
    statuses[tool] = status;
    await tmux(["kill-session", "-t", login.session]);
    return { tool, phase: "done" };
  }
  if (parsed.phase === "done") return { tool, phase: "verifying" };
  const state = { tool, phase: parsed.phase };
  if (parsed.url) state.url = parsed.url;
  if (parsed.code) state.code = parsed.code;
  if (parsed.message) state.message = parsed.message;
  return state;
}

async function endLogin() {
  if (login) await tmux(["kill-session", "-t", login.session]);
  login = null;
}

async function sendCode(input) {
  if (!login || login.tool !== "claude" || login.final) return { error: "No sign-in is waiting for a code", status: 409 };
  const code = validateCode(input);
  if (!code) return { error: "That code doesn't look right. Copy it again from the Claude page.", status: 400 };
  const typed = await tmux(["send-keys", "-t", login.session, "-l", "--", code]);
  if (typed.code !== 0) return { error: "Sign-in stopped. Try again.", status: 409 };
  await tmux(["send-keys", "-t", login.session, "Enter"]);
  login.codeSent = true;
  forget("claude");
  return { ok: true };
}

// ---- open Claude or Codex in the shared terminal session ----

async function openTool(tool) {
  if (!installed(TOOLS[tool].bin)) return { error: "Not installed", status: 409 };
  await ensureTmuxServer();
  if ((await tmux(["has-session", "-t", MAIN_SESSION])).code !== 0) {
    await tmux(["new-session", "-d", "-s", MAIN_SESSION, "-c", home]);
  }
  const dir = existsSync(`${home}/projects`) ? `${home}/projects` : home;
  // A fresh window with a shell, so quitting the tool leaves a prompt instead of closing.
  const created = await tmux(["new-window", "-P", "-F", "#{window_id}", "-t", `${MAIN_SESSION}:`, "-c", dir, "-n", tool]);
  const windowId = created.stdout.trim();
  if (created.code !== 0 || !/^@\d+$/.test(windowId)) return { error: "Could not open the terminal", status: 500 };
  await tmux(["send-keys", "-t", windowId, "-l", "--", TOOLS[tool].bin]);
  await tmux(["send-keys", "-t", windowId, "Enter"]);
  return { ok: true };
}

// ---- self-update: fetch update.sh from the control plane, run it outside this unit ----

let lastUpdate = 0;
async function startUpdate() {
  if (!controlPlane) return { error: "Self-hosted box: run update.sh by hand", status: 409 };
  if (Date.now() - lastUpdate < 60000) return { ok: true, already: true };
  lastUpdate = Date.now();
  const response = await fetch(`${controlPlane}/box/update.sh`, { signal: AbortSignal.timeout(20000), cache: "no-store" });
  const script = response.ok ? await response.text() : "";
  if (!script.startsWith("#!/bin/bash") || script.length > 200000) return { error: "Update not available", status: 502 };
  writeFileSync("/var/lib/chillrig/update.sh.next", script, { mode: 0o700 });
  chmodSync("/var/lib/chillrig/update.sh.next", 0o700);
  renameSync("/var/lib/chillrig/update.sh.next", "/var/lib/chillrig/update.sh");
  // A transient unit outlives this process, which update.sh restarts.
  await run(
    "systemd-run",
    ["--unit", `chillrig-update-${Date.now()}`, "--collect", "--quiet", "/bin/bash", "/var/lib/chillrig/update.sh"],
    { timeoutMs: 15000, env: process.env, cwd: "/" },
  );
  return { ok: true };
}

// ---- clone + port (used by the control plane) ----

function parseRepo(input) {
  if (typeof input !== "string" || input.length > 200 || /\s/.test(input)) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search) return null;
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo || owner.startsWith(".") || repo.startsWith(".")) return null;
  return { cloneUrl: `https://github.com/${owner}/${repo}.git`, repo };
}

function isPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535 && value !== 7681 && value !== 7682;
}

function reply(res, result, origin) {
  if (result.error) return send(res, result.status || 400, { error: result.error }, origin);
  return send(res, 200, result, origin);
}

const server = http.createServer(async (req, res) => {
  let origin = null;
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const route = url.pathname.replace(/^\/_chillrig/, "") || "/";
    const requestOrigin = req.headers.origin;
    if (requestOrigin) {
      // Browsers call from the control plane only. Server-to-server calls send no Origin.
      if (!allowedOrigins.has(requestOrigin)) return send(res, 403, { error: "Origin not allowed" });
      origin = requestOrigin;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": origin || "null",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      });
      return res.end();
    }
    if (req.method === "GET" && route === "/health") {
      const ready = existsSync("/var/lib/chillrig/ready");
      return send(res, ready ? 200 : 503, { ok: ready, version: AGENT_VERSION }, origin);
    }
    if (req.method === "GET" && route === "/status") {
      const [claude, codex, gh] = await Promise.all([toolStatus("claude"), toolStatus("codex"), toolStatus("gh")]);
      const statuses = {
        claude: claude ?? { installed: installed("claude"), loggedIn: false },
        codex: codex ?? { installed: installed("codex"), loggedIn: false },
        gh: gh ?? { installed: installed("gh"), loggedIn: false },
      };
      const state = await loginState(statuses);
      return send(res, 200, { version: AGENT_VERSION, ...statuses, login: state }, origin);
    }
    if (req.method === "GET" && route === "/login/state") {
      const statuses = { claude: await toolStatus("claude"), codex: await toolStatus("codex") };
      return send(res, 200, { login: await loginState(statuses) }, origin);
    }
    if (req.method === "POST" && route === "/login/start") {
      const body = await readJson(req);
      if (body.tool !== "claude" && body.tool !== "codex") return send(res, 400, { error: "Unknown tool" }, origin);
      return reply(res, await startLogin(body.tool), origin);
    }
    if (req.method === "POST" && route === "/login/code") {
      const body = await readJson(req);
      return reply(res, await sendCode(body.code), origin);
    }
    if (req.method === "POST" && route === "/login/cancel") {
      await endLogin();
      return send(res, 200, { ok: true }, origin);
    }
    if (req.method === "POST" && route === "/terminal/open") {
      const body = await readJson(req);
      if (body.tool !== "claude" && body.tool !== "codex") return send(res, 400, { error: "Unknown tool" }, origin);
      return reply(res, await openTool(body.tool), origin);
    }
    if (req.method === "POST" && route === "/update") {
      return reply(res, await startUpdate(), origin);
    }
    if (req.method === "POST" && route === "/clone") {
      const body = await readJson(req);
      const repo = parseRepo(body.url);
      if (!repo) return send(res, 400, { error: "Invalid GitHub URL" }, origin);
      const dest = `${home}/projects/${repo.repo}`;
      if (existsSync(dest)) return send(res, 409, { error: "Already cloned" }, origin);
      const cloned = await asUser("git", ["clone", "--depth", "1", repo.cloneUrl, dest], { timeoutMs: 120000 });
      if (cloned.code !== 0) return send(res, 500, { error: "Failed" }, origin);
      return send(res, 200, { ok: true, path: `~/projects/${repo.repo}` }, origin);
    }
    if (req.method === "POST" && route === "/port") {
      const body = await readJson(req);
      const appPort = Number(body.port);
      if (!isPort(appPort)) return send(res, 400, { error: "Invalid port" }, origin);
      const template = readFileSync("/etc/chillrig/Caddyfile.tmpl", "utf8");
      writeFileSync("/etc/caddy/Caddyfile", template.replaceAll("__APP_PORT__", String(appPort)));
      writeFileSync("/etc/chillrig/app_port", String(appPort));
      await run("caddy", ["reload", "--config", "/etc/caddy/Caddyfile"], { timeoutMs: 20000, env: process.env, cwd: "/" });
      return send(res, 200, { ok: true, port: appPort }, origin);
    }
    return send(res, 404, { error: "Not found" }, origin);
  } catch {
    if (!res.headersSent) send(res, 500, { error: "Failed" }, origin);
  }
});

server.listen(port, "127.0.0.1");
