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
export type LoginPhase = "starting" | "open_url" | "waiting_code" | "verifying" | "done" | "error";
export type LoginState = { tool: Tool; phase: LoginPhase; url?: string; code?: string; message?: string };
export type ToolStatus = { installed: boolean; loggedIn: boolean; email?: string; plan?: string; user?: string };
export type BoxStatus = {
  version: number;
  claude: ToolStatus;
  codex: ToolStatus;
  gh: ToolStatus;
  login: LoginState | null;
};

/** The agent version this UI is built for. Older v2+ agents can update themselves. */
export const LATEST_AGENT_VERSION = 2;

export type BoxProblem = "no-box" | "signed-out" | "unreachable" | "legacy" | "blocked" | "request";

export class BoxError extends Error {
  kind: BoxProblem;
  status?: number;

  constructor(kind: BoxProblem, message: string = kind, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface BoxClient {
  demo: boolean;
  status(): Promise<BoxStatus>;
  startLogin(tool: Tool): Promise<void>;
  sendCode(code: string): Promise<void>;
  cancelLogin(): Promise<void>;
  /** Opens the tool in a new window of the shared terminal session, in ~/projects. */
  openTool(tool: Tool): Promise<void>;
  update(): Promise<void>;
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
      const data = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) throw new BoxError("request", data.error || "Your box could not do that", response.status);
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

  async startLogin(tool: Tool) {
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
}

/** Mock mode: the same flow with no box. Nothing leaves the browser. */
const DEMO_KEY = "chillrig-demo-box";

class DemoBoxClient implements BoxClient {
  demo = true;
  private login: { tool: Tool; at: number; codeAt: number | null } | null = null;

  private signedIn(): Record<Tool, boolean> {
    try {
      return { claude: false, codex: false, ...JSON.parse(sessionStorage.getItem(DEMO_KEY) || "{}") };
    } catch {
      return { claude: false, codex: false };
    }
  }

  private setSignedIn(tool: Tool) {
    sessionStorage.setItem(DEMO_KEY, JSON.stringify({ ...this.signedIn(), [tool]: true }));
  }

  private loginState(): LoginState | null {
    const login = this.login;
    if (!login) return null;
    const now = Date.now();
    if (now - login.at < 1200) return { tool: login.tool, phase: "starting" };
    if (login.tool === "codex") {
      if (now - login.at > 9000) {
        this.setSignedIn("codex");
        return { tool: "codex", phase: "done" };
      }
      return { tool: "codex", phase: "open_url", url: "https://auth.openai.com/codex/device", code: "DEMO-4821" };
    }
    if (login.codeAt === null) return { tool: "claude", phase: "waiting_code", url: "https://claude.ai/oauth/authorize" };
    if (now - login.codeAt < 1500) return { tool: "claude", phase: "verifying" };
    this.setSignedIn("claude");
    return { tool: "claude", phase: "done" };
  }

  async status(): Promise<BoxStatus> {
    const login = this.loginState();
    const signedIn = this.signedIn();
    return {
      version: LATEST_AGENT_VERSION,
      claude: { installed: true, loggedIn: signedIn.claude, ...(signedIn.claude ? { email: "you@example.com", plan: "max" } : {}) },
      codex: { installed: true, loggedIn: signedIn.codex },
      gh: { installed: true, loggedIn: false },
      login,
    };
  }

  async startLogin(tool: Tool) {
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
