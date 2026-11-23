// Pure helpers for projects, GitHub sign-in and task sessions in the box agent.
// No dependencies: the box downloads this file next to agent.mjs. Unit tests import it.
import { cleanPane, EXIT_MARK, extractUrls } from "./login-parse.mjs";

/** Names for new projects: lowercase, digits, - and _, starting with a letter or digit. */
export const NEW_PROJECT = /^[a-z0-9][a-z0-9-_]{0,40}$/;
/** tmux session names the agent and attach.sh accept. */
export const SESSION_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
export const TEMPLATES = ["empty", "nextjs"];
export const TASK_TOOLS = ["claude", "codex"];
export const PROMPT_MAX = 6000;

export function validNewProject(name) {
  return typeof name === "string" && NEW_PROJECT.test(name) ? name : null;
}

/** An existing folder in ~/projects (cloned repos keep GitHub's casing and dots). */
export function validProject(name) {
  if (typeof name !== "string" || name.length > 100) return null;
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name) ? name : null;
}

export function validSession(name) {
  return typeof name === "string" && SESSION_NAME.test(name) ? name : null;
}

/** cr-<project>-<base36 milliseconds>: always matches SESSION_NAME and never holds . or : (tmux). */
export function makeSessionName(project, now = Date.now()) {
  const slug =
    String(project ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .replace(/-$/, "") || "task";
  const stamp = Math.floor(now).toString(36).slice(-6);
  return `cr-${slug}-${stamp}`;
}

/** The prompt as typed, minus control characters other than newline and tab. */
export function cleanPrompt(input) {
  if (typeof input !== "string") return null;
  const text = input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
    .trim();
  if (!text || text.length > PROMPT_MAX) return null;
  return text;
}

/** One line for the sessions list. Tabs and newlines would break the tmux format line. */
export function promptTitle(prompt, max = 120) {
  const line = String(prompt ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Flags for running the tool interactively in a task session. The prompt is not here:
 * task.sh appends `-- "<prompt>"`, so a prompt that starts with "-" is never a flag.
 */
export function toolArgs(tool, autoApprove) {
  if (tool === "claude") {
    return autoApprove ? ["--dangerously-skip-permissions"] : ["--permission-mode", "acceptEdits"];
  }
  if (tool === "codex") {
    // Inline mode keeps the output in the pane, so the dashboard can show it.
    return [
      "--no-alt-screen",
      ...(autoApprove ? ["--dangerously-bypass-approvals-and-sandbox"] : ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"]),
    ];
  }
  return null;
}

/** https://github.com/<owner>/<repo>(.git) only, with nothing else in the URL. */
export function parseRepo(input) {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (text.length > 200 || /\s/.test(text)) return null;
  if (/^github\.com\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo || owner.startsWith(".") || repo.startsWith(".") || !validProject(repo)) return null;
  return { cloneUrl: `https://github.com/${owner}/${repo}.git`, owner, repo };
}

// ---- GitHub device sign-in (`gh auth login -w` with no terminal on stdin) ----

export const GH_DEVICE_URL = "https://github.com/login/device";

/** The one-time code (XXXX-XXXX) and device page that `gh auth login -w` prints. */
export function findGhDevice(text) {
  const clean = cleanPane(text);
  const code = clean.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})\b/)?.[1] ?? null;
  const url =
    extractUrls(clean).find((item) => {
      try {
        const parsed = new URL(item);
        return parsed.hostname === "github.com" && parsed.pathname.startsWith("/login/device");
      } catch {
        return false;
      }
    }) ?? null;
  return { code, url: code ? (url ?? GH_DEVICE_URL) : url };
}

/** Same phases as parseLogin in login-parse.mjs: starting | open_url | done | error. */
export function parseGhLogin(text) {
  const clean = cleanPane(text);
  const exit = clean.match(new RegExp(`${EXIT_MARK}:(\\d+)`));
  if (exit && Number(exit[1]) === 0) return { phase: "done", exitCode: 0 };
  if (exit) {
    const line = clean
      .split("\n")
      .reverse()
      .find((item) => /error|failed|expired|denied|timed out|cancel/i.test(item) && !item.includes(EXIT_MARK));
    return {
      phase: "error",
      exitCode: Number(exit[1]),
      message: line ? line.trim().replace(/\s+/g, " ").slice(0, 220) : "GitHub sign-in stopped. Try again.",
    };
  }
  const { code, url } = findGhDevice(clean);
  if (code && url) return { phase: "open_url", url, code };
  return { phase: "starting" };
}

// ---- task sessions ----

/** Separator for `tmux list-sessions -F`; titles are cleaned of tabs first. */
export const SESSION_FORMAT = [
  "#{session_name}",
  "#{@cr_tool}",
  "#{@cr_project}",
  "#{@cr_exit}",
  "#{session_created}",
  "#{pane_dead}",
  "#{@cr_title}",
].join("\t");

/** Rows from `tmux list-sessions -F SESSION_FORMAT`, task sessions only. */
export function parseSessionList(stdout) {
  const rows = [];
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    const [name, tool, project, exit, created, dead, ...title] = line.split("\t");
    if (!validSession(name) || !TASK_TOOLS.includes(tool)) continue;
    const exitCode = /^-?\d+$/.test(exit ?? "") ? Number(exit) : null;
    rows.push({
      name,
      tool,
      project: validProject(project) ?? "",
      title: title.join(" ").slice(0, 200),
      startedAt: /^\d+$/.test(created ?? "") ? Number(created) * 1000 : 0,
      running: exitCode === null && dead !== "1",
      exitCode,
    });
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

// Lines that are only borders, rules or the tools' own key hints say nothing useful.
const DECORATION = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝▔▁▏▕·•◦⎿❯›>$#%-]*$/;
const CHROME = [
  /shift\+tab to cycle/i,
  /\? for shortcuts/i,
  /for agents\b/i,
  /^\s*(?:◐|◑|◒|◓)?\s*(?:low|medium|high)\s*·\s*\/effort/i,
  /^\s*⏵⏵/,
  /Ask Codex to do anything/i,
  /^\s*Try "/,
];

/** The last few meaningful lines of a pane: no ANSI, no box chrome, each line capped. */
export function lastLines(text, count = 8, width = 160) {
  const lines = cleanPane(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
        .replace(/^[\s│┃║]+|[\s│┃║]+$/g, "")
        .trimEnd(),
    )
    .filter((line) => line && !DECORATION.test(line) && !CHROME.some((pattern) => pattern.test(line)));
  return lines.slice(-count).map((line) => (line.length > width ? `${line.slice(0, width - 1)}…` : line));
}

// ---- the tool's last message, for the task card ----

// Each transcript item starts with a bullet: Claude Code ● (⏺ on macOS), Codex •.
const ITEM = /^([●⏺•])\s+(.*)$/;
// Claude tool calls: Write(app/page.tsx), Bash(npm run build), Web Search(...), MCP tools.
const CLAUDE_TOOL = /^[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2}\(|\(MCP\)/;
// Collapsed tool groups, progress and Codex tool items. Their output lines start with
// ⎿ (Claude) or └ (Codex); Codex file edits end with "(+added -removed)".
const TOOL_ITEM = [
  /\(ctrl\+\w+ to (?:expand|see)/i,
  /^(?:Update Todos|Read \d+ files?|Searched for \d+|Listed \d+|Interrupted by user)/i,
  /^(?:Explored|Exploring|Updated Plan|Worked for|Working\b|Waited|Waiting for|Called|Calling)\b/,
  /\(\+\d+ -\d+\)$/,
  /esc to interrupt/i,
];
const TOOL_OUTPUT = /^\s*[⎿└]/;
// Lines that are never prose, even inside a message.
const NOT_PROSE = [
  /files that changed while this command ran/i,
  /^(?:[~.]?\/)?[\w.@-]+(?:\/[\w.@-]+)+\/?$/, // a bare path
  /^\s*\d+\s*[+-]\s/, // a numbered diff line
];

function isToolItem(item) {
  return CLAUDE_TOOL.test(item.head) || TOOL_ITEM.some((pattern) => pattern.test(item.head)) || item.body.some((line) => TOOL_OUTPUT.test(line));
}

/**
 * The last thing Claude or Codex said, in plain words: the final prose item in the pane,
 * without tool calls, diffs, changed-file notes, paths, chrome or key hints.
 * Up to 3 short paragraphs and max characters, or null when there is none yet.
 */
export function lastMessage(text, max = 320) {
  const items = [];
  let item = null;
  for (const raw of cleanPane(text).split("\n")) {
    const line = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").trimEnd();
    const start = line.match(ITEM);
    if (start) {
      item = { head: start[2].trim(), body: [] };
      items.push(item);
    } else if (!line.trim()) {
      if (item) item.body.push("");
    } else if (item && /^\s/.test(line) && !DECORATION.test(line) && !CHROME.some((pattern) => pattern.test(line))) {
      // Messages wrap with an indent; anything back at column 0 (a prompt, a rule, the
      // input box) ends the item.
      item.body.push(line);
    } else {
      item = null;
    }
  }
  const message = items.reverse().find((entry) => entry.head && !isToolItem(entry));
  if (!message) return null;

  const paragraphs = [];
  let current = "";
  for (const line of [message.head, ...message.body.map((value) => value.trim())]) {
    const clean = line.replace(/\*\*|`/g, "");
    if (!clean || /^(?:[-*•]|\d+\.)\s/.test(clean)) {
      if (current) paragraphs.push(current);
      current = clean;
      continue;
    }
    if (NOT_PROSE.some((pattern) => pattern.test(clean))) continue;
    current = current ? `${current} ${clean}` : clean;
  }
  if (current) paragraphs.push(current);
  const kept = paragraphs.filter(Boolean).slice(0, 3).join("\n");
  if (!kept) return null;
  if (kept.length <= max) return kept;
  const cut = kept.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * working: the tool is busy (both CLIs show "esc to interrupt" while they work).
 * waiting: the tool is open and waiting for the user. finished: it exited.
 */
export function sessionState(running, text) {
  if (!running) return "finished";
  const tail = cleanPane(text).split("\n").filter((line) => line.trim()).slice(-20).join("\n");
  return /esc to interrupt/i.test(tail) ? "working" : "waiting";
}
