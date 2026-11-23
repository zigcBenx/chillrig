/**
 * Browser-side client for the box agent. The browser talks to the box directly
 * (https://<box>/_chillrig/...): the Worker only issues the ticket and answers
 * Caddy's cheap verify call, so polling costs almost no Worker CPU.
 *
 * Every request is a CORS "simple" request (GET, or POST with a text/plain JSON body)
 * with the ticket in the query string, so there is never a preflight for Caddy's
 * forward_auth to reject. Secrets never pass through the control plane: the sign-in
 * code goes straight from this browser to the user's own box.
 */

export type Tool = "claude" | "codex";
/** GitHub signs in through the same login machinery, for private repos. */
export type LoginTool = Tool | "github";
export type LoginPhase = "starting" | "open_url" | "waiting_code" | "verifying" | "done" | "error";
export type LoginState = { tool: LoginTool; phase: LoginPhase; url?: string; code?: string; message?: string };
export type ToolStatus = { installed: boolean; loggedIn: boolean; email?: string; plan?: string; user?: string };
export type BoxStatus = {
  version: number;
  claude: ToolStatus;
  codex: ToolStatus;
  gh: ToolStatus;
  login: LoginState | null;
};

export type Template = "empty" | "nextjs";
export type Project = { name: string; git: boolean; modifiedAt: number };
export type ProjectJob = {
  kind: "create" | "clone";
  project: string;
  template?: Template;
  phase: "running" | "done" | "error";
  message?: string;
  fallback?: boolean;
  startedAt: number;
  endedAt?: number;
};
/** working: the tool is busy. waiting: it is open and waiting for you. finished: it exited. */
export type SessionState = "working" | "waiting" | "finished";
export type Session = {
  name: string;
  tool: Tool;
  project: string;
  title: string;
  startedAt: number;
  running: boolean;
  exitCode: number | null;
  state: SessionState;
  lastLines: string[];
};
export type NewSession = { project: string; prompt: string; tool: Tool; autoApprove: boolean };

/** The agent version this UI is built for. Older v2+ agents can update themselves. */
export const LATEST_AGENT_VERSION = 3;
/** Projects and task sessions need agent v3. */
export const TASKS_AGENT_VERSION = 3;

export type BoxProblem = "no-box" | "signed-out" | "unreachable" | "legacy" | "blocked" | "request";

export class BoxError extends Error {
  kind: BoxProblem;
  status?: number;
  /** The repo could not be read and GitHub is not signed in: it may be private. */
  needsGitHub: boolean;

  constructor(kind: BoxProblem, message: string = kind, status?: number, needsGitHub = false) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.needsGitHub = needsGitHub;
  }
}

export interface BoxClient {
  demo: boolean;
  status(): Promise<BoxStatus>;
  startLogin(tool: LoginTool): Promise<void>;
  sendCode(code: string): Promise<void>;
  cancelLogin(): Promise<void>;
  /** Opens the tool in a new window of the shared terminal session, in ~/projects. */
  openTool(tool: Tool): Promise<void>;
  update(): Promise<void>;
  projects(): Promise<{ projects: Project[]; job: ProjectJob | null }>;
  createProject(name: string, template: Template): Promise<{ project: string }>;
  /** Resolves at once when ~/projects/<repo> already exists ({ existing: true }). */
  cloneProject(url: string): Promise<{ project: string; existing?: boolean }>;
  sessions(): Promise<Session[]>;
  startSession(input: NewSession): Promise<{ name: string }>;
  stopSession(name: string): Promise<void>;
}

type Ticket = { ticket: string; hostname: string; demo: boolean; at: number };

// Tickets live 90 seconds; take a new one well before that.
const TICKET_MAX_AGE_MS = 60_000;

async function fetchTicket(): Promise<Ticket> {
  let response: Response;
  try {
    response = await fetch("/api/terminal/ticket", { cache: "no-store" });
  } catch {
    throw new BoxError("unreachable");
  }
  if (response.status === 401) throw new BoxError("signed-out");
  if (response.status === 404) throw new BoxError("no-box");
  if (!response.ok) throw new BoxError("unreachable");
  const body = (await response.json()) as { ticket: string; hostname: string; demo?: boolean };
  return { ticket: body.ticket, hostname: body.hostname, demo: Boolean(body.demo), at: Date.now() };
}

export async function connectBox(): Promise<BoxClient> {
  const ticket = await fetchTicket();
  return ticket.demo ? new DemoBoxClient() : new LiveBoxClient(ticket);
}

class LiveBoxClient implements BoxClient {
  demo = false;
  private ticket: Ticket;

  constructor(ticket: Ticket) {
    this.ticket = ticket;
  }

  private async freshTicket(force: boolean) {
    if (force || Date.now() - this.ticket.at > TICKET_MAX_AGE_MS) this.ticket = await fetchTicket();
    return this.ticket;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ticket = await this.freshTicket(attempt > 0);
      const url = `https://${ticket.hostname}/_chillrig${path}?ticket=${encodeURIComponent(ticket.ticket)}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          // A string body is sent as text/plain, which keeps this a simple request.
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        // Rejected tickets, an agent without CORS (v1) and an offline box all look the
        // same from here. Retry once with a new ticket, then ask the control plane.
        continue;
      }
      const data = (await response.json().catch(() => ({}))) as T & { error?: string; needsGitHub?: boolean };
      if (!response.ok) {
        throw new BoxError("request", data.error || "Your box could not do that", response.status, data.needsGitHub === true);
      }
      return data;
    }
    throw await this.diagnose();
  }

  private async diagnose() {
    try {
      const response = await fetch("/api/boxes/agent", { cache: "no-store" });
      const probe = (await response.json()) as { reachable?: boolean; version?: number | null };
      if (probe.reachable && probe.version === 1) return new BoxError("legacy");
      if (probe.reachable) return new BoxError("blocked");
    } catch {
      // Fall through.
    }
    return new BoxError("unreachable");
  }

  status() {
    return this.call<BoxStatus>("GET", "/status");
  }

  async startLogin(tool: LoginTool) {
    await this.call("POST", "/login/start", { tool });
  }

  async sendCode(code: string) {
    await this.call("POST", "/login/code", { code });
  }

  async cancelLogin() {
    await this.call("POST", "/login/cancel", {});
  }

  async openTool(tool: Tool) {
    await this.call("POST", "/terminal/open", { tool });
  }

  async update() {
    await this.call("POST", "/update", {});
  }

  projects() {
    return this.call<{ projects: Project[]; job: ProjectJob | null }>("GET", "/projects");
  }

  createProject(name: string, template: Template) {
    return this.call<{ project: string }>("POST", "/projects", { name, template });
  }

  cloneProject(url: string) {
    return this.call<{ project: string; existing?: boolean }>("POST", "/projects/clone", { url });
  }

  async sessions() {
    return (await this.call<{ sessions: Session[] }>("GET", "/sessions")).sessions;
  }

  startSession(input: NewSession) {
    return this.call<{ name: string }>("POST", "/sessions", input);
  }

  async stopSession(name: string) {
    if (!validSessionName(name)) throw new BoxError("request", "Unknown task", 400);
    await this.call("POST", `/sessions/${encodeURIComponent(name)}/stop`, {});
  }
}

/** Mock mode: the same flows with no box. Nothing leaves the browser. */
const DEMO_KEY = "chillrig-demo-box";

type DemoState = {
  signedIn: Record<LoginTool, boolean>;
  projects: Project[];
  sessions: Array<Omit<Session, "state" | "lastLines" | "running"> & { stoppedAt?: number }>;
};

class DemoBoxClient implements BoxClient {
  demo = true;
  private login: { tool: LoginTool; at: number; codeAt: number | null } | null = null;
  private job: (ProjectJob & { doneAt: number }) | null = null;

  private read(): DemoState {
    const empty: DemoState = { signedIn: { claude: false, codex: false, github: false }, projects: [], sessions: [] };
    try {
      const saved = JSON.parse(sessionStorage.getItem(DEMO_KEY) || "{}") as Partial<DemoState>;
      return {
        signedIn: { ...empty.signedIn, ...(saved.signedIn ?? {}) },
        projects: saved.projects ?? [],
        sessions: saved.sessions ?? [],
      };
    } catch {
      return empty;
    }
  }

  private write(change: (state: DemoState) => void) {
    const state = this.read();
    change(state);
    sessionStorage.setItem(DEMO_KEY, JSON.stringify(state));
  }

  private loginState(): LoginState | null {
    const login = this.login;
    if (!login) return null;
    const now = Date.now();
    if (now - login.at < 1200) return { tool: login.tool, phase: "starting" };
    if (login.tool === "codex" || login.tool === "github") {
      if (now - login.at > 9000) {
        this.write((state) => (state.signedIn[login.tool] = true));
        return { tool: login.tool, phase: "done" };
      }
      return login.tool === "github"
        ? { tool: "github", phase: "open_url", url: "https://github.com/login/device", code: "DEMO-7319" }
        : { tool: "codex", phase: "open_url", url: "https://auth.openai.com/codex/device", code: "DEMO-4821" };
    }
    if (login.codeAt === null) return { tool: "claude", phase: "waiting_code", url: "https://claude.ai/oauth/authorize" };
    if (now - login.codeAt < 1500) return { tool: "claude", phase: "verifying" };
    this.write((state) => (state.signedIn.claude = true));
    return { tool: "claude", phase: "done" };
  }

  async status(): Promise<BoxStatus> {
    const login = this.loginState();
    const { signedIn } = this.read();
    return {
      version: LATEST_AGENT_VERSION,
      claude: { installed: true, loggedIn: signedIn.claude, ...(signedIn.claude ? { email: "you@example.com", plan: "max" } : {}) },
      codex: { installed: true, loggedIn: signedIn.codex },
      gh: { installed: true, loggedIn: signedIn.github, ...(signedIn.github ? { user: "you" } : {}) },
      login,
    };
  }

  async startLogin(tool: LoginTool) {
    this.login = { tool, at: Date.now(), codeAt: null };
  }

  async sendCode(code: string) {
    if (!this.login || !code.trim()) throw new BoxError("request", "Paste the code first", 400);
    this.login.codeAt = Date.now();
  }

  async cancelLogin() {
    this.login = null;
  }

  async openTool() {}

  async update() {}

  async projects() {
    const job = this.job;
    if (job && job.phase === "running" && Date.now() >= job.doneAt) {
      job.phase = "done";
      job.endedAt = Date.now();
      this.write((state) => {
        if (!state.projects.some((item) => item.name === job.project)) {
          state.projects.unshift({ name: job.project, git: true, modifiedAt: Date.now() });
        }
      });
    }
    const { projects } = this.read();
    return { projects, job: job ? { ...job } : null };
  }

  async createProject(name: string, template: Template) {
    if (!validNewProjectName(name)) throw new BoxError("request", "Use lowercase letters, numbers, - or _ (up to 41).", 400);
    if (this.read().projects.some((item) => item.name === name)) {
      throw new BoxError("request", `You already have a project called ${name}.`, 409);
    }
    const now = Date.now();
    this.job = { kind: "create", project: name, template, phase: "running", startedAt: now, doneAt: now + (template === "nextjs" ? 6000 : 900) };
    return { project: name };
  }

  async cloneProject(url: string) {
    const project = repoFolder(url);
    if (!project) throw new BoxError("request", "Paste a link like https://github.com/you/repo", 400);
    if (this.read().projects.some((item) => item.name === project)) return { project, existing: true };
    if (/private/i.test(url) && !this.read().signedIn.github) {
      throw new BoxError("request", "Can't open that repo. If it's private, connect GitHub first.", 409, true);
    }
    const now = Date.now();
    this.job = { kind: "clone", project, phase: "running", startedAt: now, doneAt: now + 2500 };
    return { project };
  }

  async sessions(): Promise<Session[]> {
    const now = Date.now();
    return this.read()
      .sessions.filter((item) => !item.stoppedAt)
      .map((item) => {
        const age = now - item.startedAt;
        const state: SessionState = age < 25_000 ? "working" : "waiting";
        const name = item.tool === "claude" ? "Claude" : "Codex";
        const lines = [
          `❯ ${item.title}`,
          `● I'll start by looking at the project structure.`,
          `● Write(app/page.tsx)`,
          `  ⎿  Wrote 84 lines to app/page.tsx`,
          ...(age > 12_000 ? [`● Bash(npm run build)`, `  ⎿  ✓ Compiled successfully`] : []),
          state === "working" ? `✻ Working… (${Math.round(age / 1000)}s · esc to interrupt)` : `● Done. Open the App tab to see it. (${name}, demo)`,
        ];
        return { ...item, running: true, state, lastLines: lines.slice(-8) };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async startSession(input: NewSession) {
    if (!input.prompt.trim()) throw new BoxError("request", "Tell it what to build.", 400);
    const name = sessionNameFor(input.project);
    this.write((state) => {
      state.sessions.push({
        name,
        tool: input.tool,
        project: input.project,
        title: input.prompt.replace(/\s+/g, " ").trim().slice(0, 120),
        startedAt: Date.now(),
        exitCode: null,
      });
    });
    return { name };
  }

  async stopSession(name: string) {
    this.write((state) => {
      state.sessions = state.sessions.filter((item) => item.name !== name);
    });
  }
}

/** Same rules as public/box/tasks.mjs (a test keeps them in step). */
export const NEW_PROJECT_NAME = /^[a-z0-9][a-z0-9-_]{0,40}$/;
export const SESSION_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function validNewProjectName(name: string) {
  return NEW_PROJECT_NAME.test(name);
}

/** An existing folder in ~/projects: cloned repos keep GitHub's casing and dots. */
export function validProjectName(name: string | null | undefined): name is string {
  return typeof name === "string" && name.length <= 100 && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
}

export function validSessionName(name: string | null | undefined): name is string {
  return typeof name === "string" && SESSION_NAME.test(name);
}

/** What the name field turns typing into: "My Bakery!" -> "my-bakery". */
export function toProjectName(input: string) {
  return input
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/^[-_]+/, "")
    .slice(0, 41);
}

/** The repo folder a GitHub link clones into, or null when the link is not one. */
export function repoFolder(url: string) {
  const match = url.trim().match(/^(?:https:\/\/)?github\.com\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return match && !match[1].startsWith(".") ? match[1] : null;
}

function sessionNameFor(project: string) {
  const slug = project.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task";
  return `cr-${slug}-${Date.now().toString(36).slice(-6)}`;
}

/** Same rule as the agent: one printable token, at most 400 characters. */
export function cleanCode(input: string) {
  const code = input.trim();
  if (!code || code.length > 400 || /[\s\u0000-\u001f\u007f-\u009f]/.test(code)) return null;
  return code;
}

export function planLabel(plan?: string) {
  if (!plan) return null;
  const known: Record<string, string> = { max: "Max plan", pro: "Pro plan", team: "Team plan", enterprise: "Enterprise plan" };
  return known[plan.toLowerCase()] ?? null;
}
