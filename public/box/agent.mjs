// Chillrig box agent. Runs as root on 127.0.0.1:7682 behind Caddy, which checks a
// control-plane ticket (forward_auth) for everything under /_chillrig except /health.
// It also guards the app preview: Caddy asks /_chillrig/preview/check (on localhost,
// never the control plane) about the preview cookie on every request to the app.
// No dependencies. update.sh installs it in /opt/chillrig next to login-parse.mjs.
//
// It never stores, logs or returns provider tokens. The login pane is read only to
// find the sign-in URL, the device code and the result, and only those go back.
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { parseClaudeStatus, parseGhUser, parseLogin, validateCode, EXIT_MARK } from "./login-parse.mjs";
import {
  cleanPrompt,
  lastLines,
  lastMessage,
  makeSessionName,
  parseGhLogin,
  parseRepo,
  parseSessionList,
  promptTitle,
  sessionState,
  SESSION_FORMAT,
  TASK_TOOLS,
  TEMPLATES,
  toolArgs,
  validNewProject,
  validProject,
  validSession,
} from "./tasks.mjs";
import {
  NO_COMMAND,
  PREVIEW_COOKIE,
  PREVIEW_SESSION,
  previewCommand,
  previewCookie,
  previewPage,
  previewSnippet,
  pruneKeys,
  PREVIEW_MAX_AGE_S,
  readCookies,
  safeNext,
  snippetIsPublic,
  taskPrompt,
  validKey,
} from "./preview.mjs";

export const AGENT_VERSION = 4;

const user = process.env.CHILLRIG_USER || "coder";
const home = process.env.CHILLRIG_HOME || `/home/${user}`;
const port = Number(process.env.CHILLRIG_AGENT_PORT) || 7682;
// Overridable so tests can run the agent without root: /etc/chillrig and /var/lib/chillrig.
const configDir = process.env.CHILLRIG_CONFIG_DIR || "/etc/chillrig";
const stateDir = process.env.CHILLRIG_STATE_DIR || "/var/lib/chillrig";
const CADDYFILE = "/etc/caddy/Caddyfile";
const PREVIEW_IMPORT = "import /etc/chillrig/preview.caddy";
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
const projectsDir = `${home}/projects`;
// Next to this file: /opt/chillrig/task.sh on a box, public/box/task.sh in a checkout.
const taskScript = fileURLToPath(new URL("./task.sh", import.meta.url));
const MAX_TASKS = 8;
// gh gets no terminal on stdin, so it prints the code and the device URL and waits for
// the browser without asking anything. setup-git lets git clone private repos with it.
const TOOLS = {
  claude: { bin: "claude", name: "Claude Code", login: "claude auth login --claudeai" },
  codex: { bin: "codex", name: "Codex", login: "codex login --device-auth" },
  github: {
    bin: "gh",
    name: "GitHub CLI",
    login: "GH_BROWSER=true gh auth login -h github.com -p https -w </dev/null && gh auth setup-git -h github.com",
  },
};
const statusKey = (tool) => (tool === "github" ? "gh" : tool);

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
function readJson(req, limit = 8000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
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
  return cached("gh", fresh ? 1500 : login?.tool === "github" ? 2500 : 30000, ghStatus);
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
  if (!installed(spec.bin)) return { error: `${spec.name} is not installed on this box`, status: 409 };
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

async function capture(session, lines = 200) {
  const result = await tmux(["capture-pane", "-p", "-J", "-S", String(-lines), "-t", `=${session}:`]);
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
  const parsed =
    pane === null
      ? { phase: "error", message: "Sign-in stopped. Try again." }
      : tool === "github"
        ? parseGhLogin(pane)
        : parseLogin(tool, pane, { codeSent: login.codeSent });
  const key = statusKey(tool);
  let status = statuses[key];
  if (parsed.phase === "done" || parsed.phase === "error" || parsed.phase === "verifying") {
    forget(key);
    status = await toolStatus(tool, true);
  }
  // GitHub counts only once the script ends: setup-git runs after gh reports success.
  const loggedInNow =
    Boolean(status?.loggedIn) && (tool === "github" ? parsed.phase === "done" : !login.wasLoggedIn || parsed.phase === "done");
  if (loggedInNow) {
    login.final = { at: Date.now(), state: { phase: "done" } };
    statuses[key] = status;
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

// ---- projects: list, create from a template, clone from GitHub ----

let job = null; // { kind: "create" | "clone", project, template?, phase, message?, fallback?, startedAt, endedAt? }

function jobView() {
  if (!job) return null;
  const { kind, project, template, phase, message, fallback, startedAt, endedAt } = job;
  return { kind, project, template, phase, message, fallback, startedAt, endedAt };
}

function isProjectDir(name) {
  try {
    return lstatSync(`${projectsDir}/${name}`).isDirectory();
  } catch {
    return false;
  }
}

function listProjects() {
  let entries = [];
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validProject(entry.name)) continue;
    let modifiedAt = 0;
    try {
      modifiedAt = lstatSync(`${projectsDir}/${entry.name}`).mtimeMs;
    } catch {
      continue;
    }
    projects.push({ name: entry.name, git: existsSync(`${projectsDir}/${entry.name}/.git`), modifiedAt: Math.round(modifiedAt) });
  }
  return projects.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 100);
}

function busy() {
  if (job?.phase !== "running") return null;
  return { error: `Still setting up ${job.project}. One moment.`, status: 409 };
}

// Writes as the user (never as root into their home), arguments as argv.
const WRITE_README = `require("fs").writeFileSync(process.argv[1], "# " + process.argv[2] + "\\n", { flag: "wx", mode: 0o644 });`;

async function makeEmptyProject(name) {
  const dir = `${projectsDir}/${name}`;
  await asUser("mkdir", ["-p", "--", dir]);
  if (!existsSync(`${dir}/.git`)) await asUser("git", ["init", "-q", "-b", "main", "--", dir]);
  if (!existsSync(`${dir}/README.md`)) await asUser(process.execPath, ["-e", WRITE_README, "--", `${dir}/README.md`, name]);
  return isProjectDir(name);
}

// create-next-app with every answer given, so it never stops to ask. timeout(1) puts
// npx and npm in their own process group and ends all of them after 5 minutes.
const NEXT_ENV = {
  ...userEnv,
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  npm_config_yes: "true",
  npm_config_fund: "false",
  npm_config_audit: "false",
  npm_config_update_notifier: "false",
};

async function runCreate(current) {
  const { project } = current;
  let ok = false;
  if (current.template === "nextjs") {
    const result = await asUser(
      "timeout",
      ["-k", "10", "300", "npx", "--yes", "create-next-app@latest", project,
        "--ts", "--eslint", "--tailwind", "--app", "--use-npm", "--import-alias", "@/*", "--yes"],
      { cwd: projectsDir, timeoutMs: 330000, env: NEXT_ENV },
    );
    ok = result.code === 0 && existsSync(`${projectsDir}/${project}/package.json`);
    if (!ok) current.fallback = true;
    // create-next-app drops its git repo when it cannot commit (no git identity yet).
    else if (!existsSync(`${projectsDir}/${project}/.git`)) {
      await asUser("git", ["init", "-q", "-b", "main", "--", `${projectsDir}/${project}`]);
    }
  }
  if (!ok) ok = await makeEmptyProject(project);
  current.phase = ok ? "done" : "error";
  if (!ok) current.message = "Could not create the project. Try again.";
  else if (current.fallback) current.message = "Next.js setup failed, so this is an empty project. Ask Claude to set it up.";
  current.endedAt = Date.now();
}

async function createProject(body) {
  const name = validNewProject(body.name);
  if (!name) return { error: "Use lowercase letters, numbers, - or _ (up to 41).", status: 400 };
  const template = TEMPLATES.includes(body.template) ? body.template : null;
  if (!template) return { error: "Unknown template", status: 400 };
  const blocked = busy();
  if (blocked) return blocked;
  if (existsSync(`${projectsDir}/${name}`)) return { error: `You already have a project called ${name}.`, status: 409 };
  await asUser("mkdir", ["-p", "--", projectsDir]);
  job = { kind: "create", project: name, template, phase: "running", startedAt: Date.now() };
  const current = job;
  runCreate(current).catch(() => {
    current.phase = "error";
    current.message = "Could not create the project. Try again.";
    current.endedAt = Date.now();
  });
  return { ok: true, project: name, job: jobView() };
}

async function cloneProject(body) {
  const repo = parseRepo(body.url);
  if (!repo) return { error: "Paste a link like https://github.com/you/repo", status: 400 };
  if (isProjectDir(repo.repo)) return { ok: true, project: repo.repo, existing: true };
  const blocked = busy();
  if (blocked) return blocked;
  if (existsSync(`${projectsDir}/${repo.repo}`)) return { error: `~/projects/${repo.repo} is in the way.`, status: 409 };
  // A quick look first: private repos need GitHub sign-in (git asks gh for credentials).
  const probe = await asUser("git", ["ls-remote", "--", repo.cloneUrl, "HEAD"], { timeoutMs: 15000 });
  if (probe.code !== 0) {
    forget("gh");
    const gh = await toolStatus("github", true);
    if (!gh?.loggedIn) {
      return { error: "Can't open that repo. If it's private, connect GitHub first.", status: 409, needsGitHub: true };
    }
    return { error: `Can't open that repo. Check the link, and that ${gh.user ?? "your GitHub account"} can see it.`, status: 404 };
  }
  await asUser("mkdir", ["-p", "--", projectsDir]);
  job = { kind: "clone", project: repo.repo, phase: "running", startedAt: Date.now() };
  const current = job;
  asUser("timeout", ["-k", "10", "600", "git", "clone", "--quiet", "--", repo.cloneUrl, `${projectsDir}/${repo.repo}`], {
    timeoutMs: 630000,
    cwd: projectsDir,
  })
    .then((result) => {
      const ok = result.code === 0 && isProjectDir(repo.repo);
      current.phase = ok ? "done" : "error";
      if (!ok) current.message = "Clone failed. Try again.";
      current.endedAt = Date.now();
    })
    .catch(() => {
      current.phase = "error";
      current.message = "Clone failed. Try again.";
      current.endedAt = Date.now();
    });
  return { ok: true, project: repo.repo, job: jobView() };
}

// ---- task sessions: Claude or Codex working in a project, in its own tmux session ----

// Runs as the user. Saves the prompt for task.sh and answers the one-time questions the
// CLI would otherwise stop on: Claude's onboarding, folder trust and (only when the user
// chose it) the bypass-permissions notice; Codex's folder trust. Checked against
// Claude Code 2.1.330 and Codex 0.171.0. Unreadable files are left alone.
const PREPARE_TASK = `
const fs = require("fs");
const path = require("path");
const home = require("os").homedir();
const input = JSON.parse(process.argv[1]);
function readObject(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch (e) {
    return e.code === "ENOENT" ? {} : null;
  }
}
function save(file, text) {
  fs.writeFileSync(file + ".chillrig", text, { mode: 0o600 });
  fs.renameSync(file + ".chillrig", file);
}
const tasks = path.join(home, ".chillrig", "tasks");
fs.mkdirSync(tasks, { recursive: true, mode: 0o700 });
save(path.join(tasks, input.name + ".prompt"), input.prompt);
if (input.tool === "claude") {
  const file = path.join(home, ".claude.json");
  const data = readObject(file);
  if (data) {
    data.hasCompletedOnboarding = true;
    if (!data.theme) data.theme = "dark";
    if (!data.projects || typeof data.projects !== "object") data.projects = {};
    const entry = data.projects[input.cwd] && typeof data.projects[input.cwd] === "object" ? data.projects[input.cwd] : {};
    entry.hasTrustDialogAccepted = true;
    data.projects[input.cwd] = entry;
    save(file, JSON.stringify(data, null, 2));
  }
  if (input.autoApprove) {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true, mode: 0o700 });
    const file = path.join(home, ".claude", "settings.json");
    const settings = readObject(file);
    if (settings && settings.skipDangerousModePermissionPrompt !== true) {
      settings.skipDangerousModePermissionPrompt = true;
      save(file, JSON.stringify(settings, null, 2));
    }
  }
} else {
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
  const file = path.join(home, ".codex", "config.toml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") text = null;
  }
  const header = "[projects." + JSON.stringify(input.cwd) + "]";
  if (text !== null && !text.split("\\n").some((line) => line.trim() === header)) {
    const sep = text && !text.endsWith("\\n") ? "\\n\\n" : text ? "\\n" : "";
    save(file, text + sep + header + "\\ntrust_level = \\"trusted\\"\\n");
  }
}
`;

async function listSessions() {
  const rows = (await listSessionRows()).slice(0, 20);
  return Promise.all(
    rows.map(async (row, index) => {
      const pane = index < 12 ? await capture(row.name, 80) : null;
      const state = sessionState(row.running, pane ?? "");
      if (pane !== null || !row.running) noteTaskState(row, state);
      // The card shows the tool's last message; the raw pane stays in the terminal.
      return { ...row, state, summary: pane ? lastMessage(pane) : null, lastLines: pane ? lastLines(pane) : [] };
    }),
  );
}

async function startSession(body) {
  const tool = TASK_TOOLS.includes(body.tool) ? body.tool : null;
  if (!tool) return { error: "Unknown tool", status: 400 };
  const project = validProject(body.project);
  if (!project || !isProjectDir(project)) return { error: "Pick a project first", status: 400 };
  const prompt = cleanPrompt(body.prompt);
  if (!prompt) return { error: "Tell it what to build (up to 6000 characters).", status: 400 };
  if (!installed(TOOLS[tool].bin)) return { error: `${TOOLS[tool].name} is not installed on this box`, status: 409 };
  const status = await toolStatus(tool, true);
  if (!status?.loggedIn) return { error: `Sign in to ${tool === "claude" ? "Claude" : "ChatGPT"} first`, status: 409 };
  const running = (await listSessionRows()).filter((row) => row.running).length;
  if (running >= MAX_TASKS) return { error: `You have ${running} tasks running. Stop one first.`, status: 409 };

  let name = makeSessionName(project);
  if ((await tmux(["has-session", "-t", `=${name}`])).code === 0) name = makeSessionName(project, Date.now() + 1 + Math.floor(Math.random() * 1000));
  if ((await tmux(["has-session", "-t", `=${name}`])).code === 0) return { error: "Try again in a second", status: 409 };
  const cwd = `${projectsDir}/${project}`;
  const autoApprove = body.autoApprove === true;
  // Tell the tool where the preview lives, so it keeps the dev server on the right port.
  const appPortNow = appPort();
  const full = taskPrompt(prompt, { port: appPortNow, host: boxHost(), label: previewPlan(project, appPortNow)?.label });
  const prepared = await asUser(process.execPath, ["-e", PREPARE_TASK, "--", JSON.stringify({ name, tool, cwd, prompt: full, autoApprove })], {
    timeoutMs: 10000,
  });
  if (prepared.code !== 0) return { error: "Could not start the task", status: 500 };
  await ensureTmuxServer();
  // Argument form: tmux runs task.sh directly, with no shell in between.
  const created = await tmux(["new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", cwd, "--", "/bin/bash", taskScript, name, tool, ...toolArgs(tool, autoApprove)]);
  if (created.code !== 0) return { error: "Could not start the task", status: 500 };
  // One preview at a time: free the port when the preview shows another project.
  await stopPreviewUnless(project);
  const target = `=${name}:`;
  await tmux([
    "set-option", "-t", target, "@cr_tool", tool, ";",
    "set-option", "-t", target, "@cr_project", project, ";",
    "set-option", "-t", target, "@cr_title", promptTitle(prompt),
  ]);
  return { ok: true, name, project, tool };
}

async function listSessionRows() {
  const result = await tmux(["list-sessions", "-F", SESSION_FORMAT]);
  return result.code === 0 ? parseSessionList(result.stdout) : [];
}

async function stopSession(input) {
  const name = validSession(input);
  if (!name) return { error: "Unknown task", status: 400 };
  const tool = (await tmux(["show-options", "-t", `=${name}:`, "-v", "-q", "@cr_tool"])).stdout.trim();
  // Only task sessions: never the shared terminal or a sign-in.
  if (!TASK_TOOLS.includes(tool)) return { error: "Unknown task", status: 404 };
  await tmux(["kill-session", "-t", `=${name}`]);
  return { ok: true };
}

// ---- live preview: one project's dev server behind Caddy's app route ----

const previewStateFile = `${stateDir}/preview.json`;
const keysFile = `${stateDir}/preview-keys.json`;
const snippetFile = `${configDir}/preview.caddy`;
const caddyOptions = { timeoutMs: 30000, env: { ...process.env, HOME: process.env.HOME || "/root" }, cwd: "/" };

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Root-owned state, written atomically. Never into the user's home. */
function saveFile(file, text, mode = 0o600) {
  writeFileSync(`${file}.chillrig-new`, text, { mode });
  chmodSync(`${file}.chillrig-new`, mode);
  renameSync(`${file}.chillrig-new`, file);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

let previewProject = validProject(readJsonFile(previewStateFile, {})?.project);
let previewProblem = null; // { project, message } when the last start had nothing to run
let previewQueue = Promise.resolve();

/** Preview changes run one at a time: starting, stopping, port and Caddy changes. */
function queuePreview(task) {
  const run = previewQueue.then(task);
  previewQueue = run.catch(() => undefined);
  return run;
}

function rememberPreview(project) {
  previewProject = project;
  try {
    saveFile(previewStateFile, JSON.stringify({ project }));
  } catch {
    // Kept in memory; the next start writes it again.
  }
}

/** The port Caddy sends the app route to (/etc/chillrig/app_port, default 3000). */
function appPort() {
  try {
    const value = Number(readFileSync(`${configDir}/app_port`, "utf8").trim());
    return isPort(value) ? value : 3000;
  } catch {
    return 3000;
  }
}

/** The box's public name from the active Caddy template, or null while it serves :80 only. */
function boxHost() {
  try {
    const template = readFileSync(`${configDir}/Caddyfile.tmpl`, "utf8");
    return template.match(/^([a-z0-9][a-z0-9.-]*\.[a-z]{2,}) \{$/im)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function portOpen(target) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: target });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The project folder the server listening on a port runs in, or null. */
async function portOwner(target) {
  const result = await exec("ss", ["-Hltnp", `sport = :${target}`], { timeoutMs: 5000, env: process.env, cwd: "/" });
  for (const match of result.stdout.matchAll(/pid=(\d+)/g)) {
    try {
      const cwd = readlinkSync(`/proc/${match[1]}/cwd`);
      if (cwd.startsWith(`${projectsDir}/`)) return cwd.slice(projectsDir.length + 1).split("/")[0];
    } catch {
      // Gone already.
    }
  }
  return null;
}

function readPackage(dir) {
  try {
    const stat = lstatSync(`${dir}/package.json`);
    if (!stat.isFile() || stat.size > 1_000_000) return null;
    return JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  } catch {
    return null;
  }
}

/** How this project's dev server starts on a port, or null when we don't know. */
function previewPlan(project, target) {
  const dir = `${projectsDir}/${project}`;
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  return previewCommand({ pkg: readPackage(dir), files, port: target, host: boxHost() });
}

async function previewSessionInfo() {
  // tmux 3.6 answers a missing target with empty fields and exit 0, so check the name too.
  const format = "#{session_name}\t#{@cr_project}\t#{@cr_exit}\t#{pane_dead}";
  const result = await tmux(["display-message", "-p", "-t", `=${PREVIEW_SESSION}:`, format]);
  const [name = "", project = "", exit = "", dead = ""] = result.stdout.replace(/\n$/, "").split("\t");
  if (result.code !== 0 || name !== PREVIEW_SESSION) return null;
  return { project: validProject(project), stopped: dead === "1" || /^-?\d+$/.test(exit) };
}

// Runs in the preview session as the user. The dev command comes as argv, never as a
// string. Installs packages first when node_modules is missing. When the server stops,
// the exit code is saved on the session and a shell stays open with the output above.
const PREVIEW_SCRIPT = `if [ "$1" = 1 ]; then
  shift
  echo "Installing packages..."
  npm install --no-audit --no-fund || { tmux set-option -q @cr_exit 1; exec bash -l; }
else
  shift
fi
"$@"
code=$?
tmux set-option -q @cr_exit "$code" 2>/dev/null
printf '\\n\\033[2mThe preview stopped. You are in %s.\\033[0m\\n' "$PWD"
exec bash -l`;

async function stopPreviewSession() {
  if ((await tmux(["kill-session", "-t", `=${PREVIEW_SESSION}`])).code !== 0) return;
  // Give the old server a moment to let go of the port.
  const target = appPort();
  for (let i = 0; i < 15 && (await portOpen(target)); i += 1) await sleep(200);
}

async function freeAppPort(taken) {
  for (let candidate = 3000; candidate < 3020; candidate += 1) {
    if (candidate !== taken && !(await portOpen(candidate))) return candidate;
  }
  return null;
}

/**
 * Starts the project's dev server, or keeps it when it already runs.
 * auto: started by the box after a task, not by a click. A project with nothing to run
 * then leaves the current preview alone.
 */
function startPreview(project, { auto = false } = {}) {
  return queuePreview(() => runPreview(project, { auto }));
}

async function runPreview(project, { auto = false } = {}) {
  if (!validProject(project) || !isProjectDir(project)) return { error: "Pick a project first", status: 400 };
  let target = appPort();
  const current = await previewSessionInfo();
  if (current && current.project === project && !current.stopped) {
    previewProblem = null;
    rememberPreview(project);
    return { ok: true };
  }
  if (!previewPlan(project, target)) {
    if (auto) return { ok: true, skipped: true };
    // Nothing to run. Stop the other project's preview so the link never shows the wrong app.
    if (current) await stopPreviewSession();
    previewProblem = { project, message: NO_COMMAND };
    rememberPreview(project);
    return { error: NO_COMMAND, status: 409 };
  }
  if (current) await stopPreviewSession();
  if (await portOpen(target)) {
    // Claude may already run this project's server (the task prompt asks it to). Another
    // project's server keeps running; the preview moves to a free port instead.
    if ((await portOwner(target)) === project) {
      previewProblem = null;
      rememberPreview(project);
      return { ok: true };
    }
    const free = await freeAppPort(target);
    if (!free) return { error: "Every preview port is busy. Stop a dev server in the terminal first.", status: 409 };
    await applyAppPort(free);
    target = free;
  }
  const plan = previewPlan(project, target);
  if (!plan) return { error: NO_COMMAND, status: 409 };
  await ensureTmuxServer();
  const env = Object.entries(plan.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const created = await tmux([
    "new-session", "-d", "-s", PREVIEW_SESSION, "-x", "200", "-y", "50", "-c", `${projectsDir}/${project}`, ...env,
    "--", "/bin/bash", "-c", PREVIEW_SCRIPT, PREVIEW_SESSION, plan.install ? "1" : "0", ...plan.command,
  ]);
  if (created.code !== 0) return { error: "Could not start the preview", status: 500 };
  await tmux(["set-option", "-t", `=${PREVIEW_SESSION}:`, "@cr_project", project]);
  previewProblem = null;
  rememberPreview(project);
  return { ok: true };
}

/** The saved project's preview, or the newest project's when there is none yet. */
function ensurePreview() {
  const project = previewProject && isProjectDir(previewProject) ? previewProject : listProjects()[0]?.name;
  return project ? startPreview(project) : Promise.resolve(null);
}

/** One preview at a time: a task in another project gets the port. */
function stopPreviewUnless(project) {
  return queuePreview(async () => {
    const current = await previewSessionInfo();
    if (current && current.project !== project) await stopPreviewSession();
  }).catch(() => undefined);
}

// After a reboot the preview session is gone. The waiting page brings it back, at most
// twice a minute. A preview that stopped by itself stays stopped, with its output.
let lastAutoStart = 0;
async function autoStartPreview() {
  if (!previewProject || Date.now() - lastAutoStart < 30000) return;
  lastAutoStart = Date.now();
  if (await previewSessionInfo()) return;
  if (isProjectDir(previewProject) && !(await portOpen(appPort()))) await startPreview(previewProject);
}

function previewIsPublic() {
  try {
    return snippetIsPublic(readFileSync(snippetFile, "utf8"));
  } catch {
    return false;
  }
}

/** Boxes from before agent v4 proxy the app with no check until update.sh migrates Caddy. */
function previewProtectable() {
  try {
    return readFileSync(`${configDir}/Caddyfile.tmpl`, "utf8").includes(PREVIEW_IMPORT);
  } catch {
    return false;
  }
}

async function previewStatus() {
  const target = appPort();
  const [session, open] = await Promise.all([previewSessionInfo(), portOpen(target)]);
  const project = previewProject;
  let state = "none";
  if (previewProblem && previewProblem.project === project) state = "error";
  else if (open) state = "running";
  else if (session && !session.stopped) state = "starting";
  else if (project) state = "stopped";
  const protectable = previewProtectable();
  // output: the preview session exists, so its terminal shows what happened.
  const view = { project, port: target, state, public: !protectable || previewIsPublic(), protected: protectable, output: Boolean(session) };
  if (state === "error") view.message = previewProblem.message;
  return view;
}

// ---- preview cookie: random keys, only their hashes on disk ----

let previewKeys = pruneKeys(readJsonFile(keysFile, []));

function issuePreviewKey() {
  const key = randomBytes(32).toString("base64url");
  previewKeys = pruneKeys([...previewKeys, { hash: sha256(key), exp: Date.now() + PREVIEW_MAX_AGE_S * 1000 }]);
  try {
    saveFile(keysFile, JSON.stringify(previewKeys));
  } catch {
    // Still valid until the agent restarts.
  }
  return key;
}

function previewKeyValid(cookieHeader) {
  const now = Date.now();
  return readCookies(cookieHeader, PREVIEW_COOKIE).some((value) => {
    if (!validKey(value)) return false;
    const hash = sha256(value);
    return previewKeys.some((key) => key.exp > now && key.hash === hash);
  });
}

// Caddy's forward_auth for every app request when the preview is private. On localhost
// only: no control-plane call after the first visit.
function previewCheck(req, res) {
  if (previewKeyValid(req.headers.cookie)) {
    res.writeHead(200, { "cache-control": "no-store" });
    return res.end();
  }
  const mode = req.headers["sec-fetch-mode"];
  const page = mode ? mode === "navigate" : String(req.headers.accept || "").includes("text/html");
  const method = String(req.headers["x-forwarded-method"] || "GET");
  if (page && (method === "GET" || method === "HEAD")) {
    // Managed boxes: the control plane checks the owner's session and sends them back with
    // a ticket. Self-hosted: /_chillrig is behind basic auth, so enter there directly.
    const next = encodeURIComponent(safeNext(String(req.headers["x-forwarded-uri"] || "/")));
    const location = controlPlane ? `${controlPlane}/api/boxes/preview?next=${next}` : `/_chillrig/preview/enter?next=${next}`;
    res.writeHead(302, { location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
    return res.end();
  }
  res.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  return res.end("This preview is private.\n");
}

// Reached through /_chillrig/*, so Caddy has already checked the ticket (or basic auth).
async function previewEnter(req, res, url) {
  const requested = url.searchParams.get("project");
  const name = requested === null ? null : validProject(requested);
  const starting = name && isProjectDir(name) ? startPreview(name) : requested === null ? ensurePreview() : Promise.resolve(null);
  // Wait a little, so switching projects never lands on the old app; never for long.
  await Promise.race([starting.catch(() => null), sleep(8000)]);
  res.writeHead(303, {
    location: safeNext(url.searchParams.get("next") ?? "/"),
    "set-cookie": previewCookie(issuePreviewKey(), { frame: req.headers["sec-fetch-dest"] === "iframe" }),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  res.end();
}

// Caddy shows this (handle_errors) while nothing answers on the app port.
async function previewWaiting(res) {
  await autoStartPreview().catch(() => null);
  const status = await previewStatus();
  const page =
    status.state === "error"
      ? { title: "No preview yet", message: status.message, refresh: 0 }
      : status.state === "stopped"
        ? { title: "The preview stopped", message: "Open the terminal from your Chillrig dashboard to see why, or ask Claude to fix it.", refresh: 10 }
        : status.state === "none"
          ? { title: "Nothing to preview yet", message: "Start a task from your Chillrig dashboard. Your app shows up here.", refresh: 10 }
          : { title: "Starting your preview", message: "This takes a few seconds. The page reloads by itself.", refresh: 2 };
  res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "2" });
  res.end(previewPage(page));
}

/** Validates a Caddyfile, swaps it in and reloads. On any failure the old files come back. */
async function reloadCaddy(content, restore = () => {}) {
  const next = `${CADDYFILE}.chillrig-next`;
  writeFileSync(next, content, { mode: 0o644 });
  const valid = await exec("caddy", ["validate", "--config", next, "--adapter", "caddyfile"], caddyOptions);
  if (valid.code !== 0) {
    rmSync(next, { force: true });
    restore();
    throw new Error("invalid Caddyfile");
  }
  const previous = readFileSync(CADDYFILE, "utf8");
  renameSync(next, CADDYFILE);
  const reloaded = await exec("caddy", ["reload", "--config", CADDYFILE, "--adapter", "caddyfile"], caddyOptions);
  if (reloaded.code !== 0) {
    writeFileSync(CADDYFILE, previous);
    restore();
    await exec("caddy", ["reload", "--config", CADDYFILE, "--adapter", "caddyfile"], caddyOptions);
    throw new Error("caddy reload failed");
  }
}

function ensureSnippet() {
  if (!existsSync(snippetFile)) saveFile(snippetFile, previewSnippet(false), 0o644);
}

async function applyAppPort(appPort) {
  ensureSnippet();
  const template = readFileSync(`${configDir}/Caddyfile.tmpl`, "utf8");
  await reloadCaddy(template.replaceAll("__APP_PORT__", String(appPort)));
  writeFileSync(`${configDir}/app_port`, String(appPort));
}

async function setPreviewPublic(value) {
  if (typeof value !== "boolean") return { error: "Choose public or private", status: 400 };
  if (!previewProtectable()) return { error: "Update your box first", status: 409 };
  ensureSnippet();
  const before = readFileSync(snippetFile, "utf8");
  saveFile(snippetFile, previewSnippet(value), 0o644);
  try {
    await reloadCaddy(readFileSync(CADDYFILE, "utf8"), () => saveFile(snippetFile, before, 0o644));
  } catch {
    return { error: "Could not change that. Try again.", status: 500 };
  }
  return { ok: true, preview: await previewStatus() };
}

// ---- the box starts the preview itself when a task stops working ----

const taskStates = new Map(); // session name -> last state seen

function noteTaskState(row, state) {
  const before = taskStates.get(row.name);
  taskStates.set(row.name, state);
  // Finished, or waiting for the user: start that project's preview. It never depends on
  // the tool remembering to.
  if (before === "working" && state !== "working" && row.project) startPreview(row.project, { auto: true }).catch(() => null);
}

let watching = false;
async function watchTasks() {
  if (watching) return;
  watching = true;
  try {
    const rows = (await listSessionRows()).slice(0, 12);
    const names = new Set(rows.map((row) => row.name));
    for (const name of taskStates.keys()) if (!names.has(name)) taskStates.delete(name);
    for (const row of rows) {
      const pane = row.running ? await capture(row.name, 40) : "";
      if (pane !== null) noteTaskState(row, sessionState(row.running, pane));
    }
  } catch {
    // Try again on the next tick.
  } finally {
    watching = false;
  }
}

// ---- clone + port (used by the control plane) ----

function isPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535 && value !== 7681 && value !== 7682;
}

function reply(res, result, origin) {
  if (result.error) {
    const body = result.needsGitHub ? { error: result.error, needsGitHub: true } : { error: result.error };
    return send(res, result.status || 400, body, origin);
  }
  return send(res, 200, result, origin);
}

const server = http.createServer(async (req, res) => {
  let origin = null;
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const route = url.pathname.replace(/^\/_chillrig/, "") || "/";
    // Caddy's own calls for the app preview. They carry the visitor's headers (an app can
    // send any Origin), so they come before the Origin check.
    if (route === "/preview/check") return previewCheck(req, res);
    if (route === "/preview/waiting") return await previewWaiting(res);
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
      const statuses = { claude: await toolStatus("claude"), codex: await toolStatus("codex"), gh: await toolStatus("github") };
      return send(res, 200, { login: await loginState(statuses) }, origin);
    }
    if (req.method === "POST" && route === "/login/start") {
      const body = await readJson(req);
      if (!Object.hasOwn(TOOLS, body.tool)) return send(res, 400, { error: "Unknown tool" }, origin);
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
    if (req.method === "GET" && route === "/projects") {
      return send(res, 200, { projects: listProjects(), job: jobView() }, origin);
    }
    if (req.method === "POST" && route === "/projects") {
      return reply(res, await createProject(await readJson(req)), origin);
    }
    if (req.method === "POST" && route === "/projects/clone") {
      return reply(res, await cloneProject(await readJson(req)), origin);
    }
    if (req.method === "GET" && route === "/sessions") {
      const [sessions, preview] = await Promise.all([listSessions(), previewStatus()]);
      return send(res, 200, { sessions, preview }, origin);
    }
    if (req.method === "GET" && route === "/preview/enter") {
      return await previewEnter(req, res, url);
    }
    if (req.method === "GET" && route === "/preview") {
      return send(res, 200, await previewStatus(), origin);
    }
    if (req.method === "POST" && route === "/preview/public") {
      const body = await readJson(req);
      return reply(res, await queuePreview(() => setPreviewPublic(body.public)), origin);
    }
    if (req.method === "POST" && route === "/sessions") {
      return reply(res, await startSession(await readJson(req, 16000)), origin);
    }
    const stop = req.method === "POST" ? route.match(/^\/sessions\/([^/]+)\/stop$/) : null;
    if (stop) {
      return reply(res, await stopSession(stop[1]), origin);
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
      await queuePreview(async () => {
        await applyAppPort(appPort);
        // A running preview moves to the new port with Caddy.
        const current = await previewSessionInfo();
        if (current?.project && !current.stopped) {
          await tmux(["kill-session", "-t", `=${PREVIEW_SESSION}`]);
          await runPreview(current.project);
        }
      });
      return send(res, 200, { ok: true, port: appPort }, origin);
    }
    return send(res, 404, { error: "Not found" }, origin);
  } catch {
    if (!res.headersSent) send(res, 500, { error: "Failed" }, origin);
  }
});

server.listen(port, "127.0.0.1");
setInterval(() => void watchTasks(), 10000);
