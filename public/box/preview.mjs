// Pure helpers for the live app preview: how to start a project's dev server, the
// preview cookie and the Caddy snippet that keeps the preview private.
// No dependencies: the box downloads this file next to agent.mjs. Unit tests import it.

/** The tmux session the preview dev server runs in. One preview at a time. */
export const PREVIEW_SESSION = "chillrig-preview";
export const PREVIEW_COOKIE = "chillrig_preview";
export const PREVIEW_MAX_AGE_S = 12 * 60 * 60;
/** Cookie keys the box keeps at once (one per browser that opened the preview). */
export const PREVIEW_MAX_KEYS = 40;
export const NO_COMMAND = "This project has no dev script yet. Ask Claude to add one, then open the preview again.";

const PUBLIC_MARK = "# Chillrig: the app preview is public.";

/**
 * /etc/chillrig/preview.caddy, imported by the catch-all route in Caddy's templates.
 * Private: Caddy asks the box agent (localhost only) to check the preview cookie on
 * every request, so nothing reaches the control plane after the first visit.
 */
export function previewSnippet(isPublic) {
  if (isPublic) return `${PUBLIC_MARK}\n`;
  return [
    "# Chillrig: the app preview is private. The box agent checks the preview cookie.",
    "forward_auth 127.0.0.1:7682 {",
    "\turi /_chillrig/preview/check",
    "}",
    "",
  ].join("\n");
}

/** Anything that is not exactly the public snippet counts as private. */
export function snippetIsPublic(text) {
  return typeof text === "string" && text.trim() === PUBLIC_MARK;
}

// ---- how to start a project's dev server ----

/** Flags each dev CLI understands for host and port, matched against the dev script. */
const FRAMEWORKS = [
  { test: /\bnext\s+dev\b/, flags: (port) => ["-H", "0.0.0.0", "-p", port] },
  { test: /\bastro\s+dev\b/, flags: (port) => ["--host", "0.0.0.0", "--port", port] },
  { test: /\bnux[ti]\s+dev\b/, flags: (port) => ["--host", "0.0.0.0", "--port", port] },
  { test: /\breact-router\s+dev\b/, flags: (port) => ["--host", "0.0.0.0", "--port", port] },
  { test: /\bng\s+serve\b/, flags: (port) => ["--host", "0.0.0.0", "--port", port] },
  { test: /\bgatsby\s+develop\b/, flags: (port) => ["-H", "0.0.0.0", "-p", port] },
  { test: /\bwebpack(?:-dev-server|\s+serve)\b/, flags: (port) => ["--host", "0.0.0.0", "--port", port] },
  // Plain Vite, SvelteKit (vite dev) and Remix (remix vite:dev) take Vite's flags.
  { test: /\bvite\b/, flags: (port) => ["--host", "0.0.0.0", "--port", port, "--strictPort"] },
];

/** Without a dev script: start the framework the project depends on, if we know it. */
const DEFAULTS = [
  { dep: "next", args: (port) => ["next", "dev", "-H", "0.0.0.0", "-p", port] },
  { dep: "astro", args: (port) => ["astro", "dev", "--host", "0.0.0.0", "--port", port] },
  { dep: "nuxt", args: (port) => ["nuxt", "dev", "--host", "0.0.0.0", "--port", port] },
  { dep: "vite", args: (port) => ["vite", "--host", "0.0.0.0", "--port", port, "--strictPort"] },
];

/**
 * How to run a project's dev server on 0.0.0.0:<port>, or null when there is no known way.
 *   pkg:   the parsed package.json, or null
 *   files: names in the project folder (to spot index.html and node_modules)
 *   host:  the box's public name, which Vite must be told to accept
 * Returns { command: argv, env, install, label }. install: run npm install first.
 * @param {{ pkg: any, files?: string[], port: number | string, host?: string | null }} input
 * @returns {{ command: string[], env: Record<string, string>, install: boolean, label: string } | null}
 */
export function previewCommand({ pkg, files = [], port, host = null }) {
  const p = String(port);
  const names = new Set(files);
  /** @type {Record<string, string>} */
  const env = { PORT: p, HOST: "0.0.0.0", BROWSER: "none", NEXT_TELEMETRY_DISABLED: "1" };
  // Vite 6+ refuses requests for a Host it does not know; this is its documented escape hatch.
  if (host) env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = host;
  const hasPackage = Boolean(pkg && typeof pkg === "object" && !Array.isArray(pkg));
  const scripts = hasPackage && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const install = hasPackage && !names.has("node_modules");
  const plan = (command) => ({ command, env, install, label: command.join(" ") });

  if (typeof scripts.dev === "string" && scripts.dev.trim()) {
    const framework = FRAMEWORKS.find((item) => item.test.test(scripts.dev));
    const flags = framework ? framework.flags(p) : [];
    return plan(["npm", "run", "dev", ...(flags.length ? ["--", ...flags] : [])]);
  }
  if (hasPackage) {
    const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
    const known = DEFAULTS.find((item) => Object.hasOwn(deps, item.dep));
    // --no: never download a package that is not already in the project.
    if (known) return plan(["npx", "--no", ...known.args(p)]);
    if (typeof scripts.start === "string" && scripts.start.trim()) return plan(["npm", "start"]);
    return null;
  }
  if (names.has("index.html")) {
    return { ...plan(["python3", "-m", "http.server", p, "--bind", "0.0.0.0"]), install: false };
  }
  return null;
}

/** What to suggest to Claude or Codex when the project has no known command yet. */
export function suggestedCommand(port) {
  return `npm run dev -- -H 0.0.0.0 -p ${port}`;
}

/**
 * The task prompt plus a short note about the preview. It goes to the tool as one
 * argument after "--" (task.sh), never through a shell string.
 */
export function taskPrompt(prompt, { port, host, label } = {}) {
  const where = host ? `https://${host}/` : "this box's web address";
  const command = label || `${suggestedCommand(port)} for Next.js, or the same flags for your stack`;
  const allow = host ? ` If the dev server only accepts known hosts (Next.js allowedDevOrigins, Vite server.allowedHosts), allow ${host}.` : "";
  return [
    prompt,
    "",
    `(Chillrig: the live preview of this project is ${where}, served from port ${port} on this box. ` +
      `If you build or change a web app, keep its dev server running on 0.0.0.0:${port} (for example \`${command}\`) ` +
      `and check it with \`curl -sI http://127.0.0.1:${port}\`. If it already answers for this project, leave it running.${allow})`,
  ].join("\n");
}

// ---- cookie and redirects ----

/** Every value of one cookie in a Cookie header (a browser can send several). */
export function readCookies(header, name) {
  if (typeof header !== "string" || !header) return [];
  const values = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    values.push(part.slice(eq + 1).trim());
  }
  return values;
}

/** A preview key: 32 random bytes in base64url. Anything else is never looked up. */
export function validKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Set-Cookie for the preview. A link opened in a tab is first-party, so Lax is enough.
 * Inside the dashboard's iframe the box is a third party: the cookie must be
 * SameSite=None and Partitioned (CHIPS), or the browser drops it.
 */
export function previewCookie(value, { frame = false, maxAge = PREVIEW_MAX_AGE_S } = {}) {
  const parts = [`${PREVIEW_COOKIE}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "Secure"];
  parts.push(frame ? "SameSite=None" : "SameSite=Lax");
  if (frame) parts.push("Partitioned");
  return parts.join("; ");
}

/** A same-site path to land on after sign-in. Anything odd becomes "/". */
export function safeNext(input) {
  if (typeof input !== "string" || input.length > 500) return "/";
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return "/";
  if (input.startsWith("/_chillrig/") || input.startsWith("/ttyd/")) return "/";
  return input;
}

/** Drops expired keys and keeps the newest ones. keys: [{ hash, exp }] */
export function pruneKeys(keys, now = Date.now(), max = PREVIEW_MAX_KEYS) {
  return (Array.isArray(keys) ? keys : [])
    .filter((key) => key && typeof key.hash === "string" && /^[a-f0-9]{64}$/.test(key.hash) && Number(key.exp) > now)
    .sort((a, b) => a.exp - b.exp)
    .slice(-max);
}

// ---- the page Caddy shows while the dev server is not answering ----

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** A small calm page. refresh: seconds until the browser tries again (0 = never). */
export function previewPage({ title, message, refresh = 0 }) {
  const meta = refresh > 0 ? `<meta http-equiv="refresh" content="${Number(refresh)}">` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:Canvas;color:CanvasText}
main{max-width:26rem;padding:2rem;text-align:center}
h1{font-size:1.25rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .5rem}
p{margin:0;opacity:.65;line-height:1.5;font-size:.95rem}
</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>
`;
}
