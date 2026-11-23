// Pure helpers for the Chillrig box agent (agent.mjs) and the unit tests.
// No dependencies: the box downloads this file next to agent.mjs.

/** The login session prints this with the CLI's exit code when the CLI ends. */
export const EXIT_MARK = "__CHILLRIG_EXIT__";

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const URL_TOKEN = /^[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#[\]]+$/;

export function cleanPane(text) {
  return String(text ?? "").replace(ANSI, "").replace(/\r/g, "");
}

/**
 * Every https URL in the captured pane. A URL that runs to the end of its line and
 * continues on the next one (a hard wrap) is joined back together. The capture uses
 * `tmux capture-pane -J`, which already joins soft wraps; this is the fallback.
 */
export function extractUrls(text) {
  const lines = cleanPane(text).split("\n").map((line) => line.trimEnd());
  const urls = [];
  for (let i = 0; i < lines.length; i += 1) {
    const found = [...lines[i].matchAll(/https:\/\/[^\s<>"'`]+/g)];
    for (const match of found) {
      let url = match[0];
      const atLineEnd = match.index + url.length === lines[i].length;
      if (atLineEnd) {
        // Continuation lines start at column 0 and hold nothing but URL characters.
        while (i + 1 < lines.length && lines[i + 1] && !/^\s/.test(lines[i + 1]) && URL_TOKEN.test(lines[i + 1])) {
          url += lines[i + 1];
          i += 1;
        }
      }
      urls.push(url.replace(/[.,;:]+$/, ""));
    }
  }
  return urls;
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function hostIn(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The OAuth URL `claude auth login` prints. Only Anthropic hosts are accepted. */
export function findClaudeUrl(text) {
  return (
    extractUrls(text).find((url) => {
      const host = hostOf(url);
      return hostIn(host, ["claude.ai", "claude.com", "anthropic.com"]) && /oauth|authorize/i.test(url);
    }) ?? null
  );
}

/** The device page and one-time code `codex login --device-auth` prints. */
export function findCodexDevice(text) {
  const url = extractUrls(text).find((item) => hostIn(hostOf(item), ["openai.com", "chatgpt.com"])) ?? null;
  const lines = cleanPane(text).split("\n");
  const start = lines.findIndex((line) => /one-time code|enter (this|the) code/i.test(line));
  let code = null;
  for (const line of start >= 0 ? lines.slice(start) : lines) {
    const match = line.match(/^\s*([A-Z0-9]{3,10}(?:-[A-Z0-9]{3,10})+)\s*$/);
    if (match) {
      code = match[1];
      break;
    }
  }
  return { url, code };
}

function exitCodeOf(text) {
  const match = text.match(new RegExp(`${EXIT_MARK}:(\\d+)`));
  return match ? Number(match[1]) : null;
}

function shortMessage(line) {
  return line.trim().replace(/\s+/g, " ").slice(0, 220);
}

/**
 * Reads the state of a CLI login from its tmux pane.
 * phase: starting | open_url (codex: open the page, type the code) |
 *        waiting_code (claude: paste the code back) | verifying | done | error
 */
export function parseLogin(tool, text, { codeSent = false } = {}) {
  const clean = cleanPane(text);
  const exitCode = exitCodeOf(clean);
  const lines = clean.split("\n").filter((line) => line.trim() && !line.includes(EXIT_MARK));
  const isError = (line) => /couldn'?t log in|login failed|failed to|error|invalid|expired|denied|not accepted/i.test(line);

  if (tool === "codex") {
    const { url, code } = findCodexDevice(clean);
    if (exitCode === 0) return { phase: "done", exitCode };
    if (exitCode !== null) {
      const line = [...lines].reverse().find(isError);
      return { phase: "error", exitCode, message: line ? shortMessage(line) : "Sign-in stopped. Try again." };
    }
    if (url && code) return { phase: "open_url", url, code };
    return { phase: "starting" };
  }

  const url = findClaudeUrl(clean);
  if (exitCode === 0) return { phase: "done", exitCode, url };
  // Only output after the last code prompt counts, so a retry prompt clears an old error.
  let lastPrompt = -1;
  lines.forEach((line, index) => {
    if (/paste code|enter code/i.test(line)) lastPrompt = index;
  });
  const after = lines.slice(lastPrompt + 1);
  const errorLine = [...after].reverse().find((line) => isError(line) && !/https:\/\//.test(line));
  if (exitCode !== null) {
    return { phase: "error", exitCode, message: errorLine ? shortMessage(errorLine) : "Sign-in stopped. Try again." };
  }
  if (errorLine) return { phase: "error", message: shortMessage(errorLine) };
  if (codeSent) return { phase: "verifying", url };
  if (url) return { phase: "waiting_code", url };
  return { phase: "starting" };
}

/** The code pasted from the Claude page: one printable token, at most 400 characters. */
export function validateCode(input) {
  if (typeof input !== "string") return null;
  const code = input.trim();
  if (!code || code.length > 400) return null;
  if (/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(code)) return null;
  return code;
}

/** `claude auth status --json`, reduced to what the UI may show. Never tokens. */
export function parseClaudeStatus(stdout) {
  try {
    const data = JSON.parse(String(stdout ?? ""));
    const loggedIn = data?.loggedIn === true;
    return {
      loggedIn,
      email: loggedIn && typeof data.email === "string" ? data.email.slice(0, 200) : undefined,
      plan: loggedIn && typeof data.subscriptionType === "string" ? data.subscriptionType.slice(0, 40) : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

/** `gh auth status` output: who is signed in to github.com, if anyone. */
export function parseGhUser(output) {
  const match = String(output ?? "").match(/Logged in to github\.com (?:account|as) ([A-Za-z0-9-]{1,39})/);
  return match ? match[1] : undefined;
}
