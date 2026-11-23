"use client";

import { GitHubIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BoxError,
  LATEST_AGENT_VERSION,
  repoFolder,
  toProjectName,
  validNewProjectName,
  type BoxClient,
  type BoxStatus,
  type LoginState,
  type Project,
  type ProjectJob,
  type Template,
  type Tool,
} from "@/lib/box-client";
import { Check, ChevronLeft, ChevronRight, Copy, Eye, Folder, Loader2, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// Steps 2 and 3 of /start (pick a project, say what to build) and the box update gate.
// Same rules as the sign-in step: the browser talks to the box directly with a ticket.

export type ProjectKind = Template | "repo" | "existing";
export type Picked = { project: string; kind: ProjectKind; note?: string };
export type Started = { name: string; project: string; tool: Tool };
export type ProjectMode = "choose" | "new" | "github";

const ACTIVE = new Set(["starting", "open_url", "waiting_code", "verifying"]);
const TOOL_NAME: Record<Tool, string> = { claude: "Claude", codex: "Codex" };

const EXAMPLES: Record<"nextjs" | "empty" | "repo", string[]> = {
  nextjs: [
    "Build a landing page for my bakery with a contact form",
    "Make a to-do app that remembers my tasks",
    "Create a portfolio with a page for each of my projects",
  ],
  empty: [
    "Build a landing page for my bakery with a contact form",
    "Make a simple game I can play on my phone",
    "Write a script that renames my photos by the date they were taken",
  ],
  repo: ["Explain this project and how to run it", "Find and fix the most obvious bugs", "Make it look great on phones"],
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function Waiting({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-sm" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  );
}

// ---- box update: POST /update, then watch /status until the new agent answers ----

export function useBoxUpdate(client: BoxClient, onStatus: (status: BoxStatus) => void) {
  const [phase, setPhase] = useState<"idle" | "updating" | "slow">("idle");
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    setPhase("updating");
    setError(null);
    try {
      await client.update();
    } catch (reason) {
      if (reason instanceof BoxError && reason.kind === "request") {
        setPhase("idle");
        setError(reason.message);
        return;
      }
      // The agent can restart before it answers. Keep checking below.
    }
    const until = Date.now() + 240_000;
    await wait(6000);
    while (alive.current && Date.now() < until) {
      try {
        const next = await client.status();
        if (!alive.current) return;
        if (next.version >= LATEST_AGENT_VERSION) {
          setPhase("idle");
          onStatus(next);
          return;
        }
      } catch {
        // Restarting. Try again in a moment.
      }
      await wait(4000);
    }
    if (alive.current) setPhase("slow");
  }, [client, onStatus]);

  return { phase, error, start };
}

export function UpdateBanner({ client, onStatus }: { client: BoxClient; onStatus: (status: BoxStatus) => void }) {
  const update = useBoxUpdate(client, onStatus);
  const busy = update.phase === "updating";
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[var(--chip-border)] bg-[var(--chip-fill)] px-4 py-3 text-sm">
      <span>
        {busy ? "Updating your box. About a minute." : update.phase === "slow" ? "Still updating. Check back soon." : (update.error ?? "A box update is ready.")}
      </span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void update.start()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Updating" /> : "Update"}
      </Button>
    </div>
  );
}

export function UpdateGate({ client, onStatus }: { client: BoxClient; onStatus: (status: BoxStatus) => void }) {
  const update = useBoxUpdate(client, onStatus);
  const busy = update.phase === "updating";
  return (
    <div className="py-4 text-center">
      <span className="icon-blob mx-auto h-14 w-14">
        <RefreshCw className={`h-6 w-6 ${busy ? "animate-spin" : ""}`} aria-hidden />
      </span>
      <h1 className="headline mt-5 text-3xl">Update your box</h1>
      <p className="muted mx-auto mt-2 max-w-sm text-sm">
        {busy
          ? "Updating. About a minute. Your files and sessions stay as they are."
          : update.phase === "slow"
            ? "This is taking longer than usual. Try again in a few minutes."
            : "Projects and tasks need the latest box software. It takes about a minute."}
      </p>
      {update.error ? (
        <p className="danger mt-3 text-sm" role="alert">
          {update.error}
        </p>
      ) : null}
      <Button className="btn-lg mt-8 w-full" disabled={busy} onClick={() => void update.start()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busy ? "Updating" : "Update your box"}
      </Button>
    </div>
  );
}

// ---- step 2: a project (new, from GitHub, or one you already have) ----

export function ProjectStep({
  client,
  mode,
  onMode,
  onPicked,
}: {
  client: BoxClient;
  mode: ProjectMode;
  onMode: (mode: ProjectMode) => void;
  onPicked: (picked: Picked) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [job, setJob] = useState<ProjectJob | null>(null);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<Template>("nextjs");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsGitHub, setNeedsGitHub] = useState(false);
  const watching = useRef<string | null>(null);

  useEffect(() => {
    let cancel = false;
    client
      .projects()
      .then((data) => {
        if (cancel) return;
        setProjects(data.projects);
        // A job from an earlier visit is still running: pick it up.
        if (data.job?.phase === "running") {
          watching.current = data.job.project;
          setJob(data.job);
          onMode(data.job.kind === "clone" ? "github" : "new");
        }
      })
      .catch(() => {
        if (!cancel) setProjects([]);
      });
    return () => {
      cancel = true;
    };
  }, [client, onMode]);

  const running = job?.phase === "running";

  useEffect(() => {
    if (!running) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const data = await client.projects();
        if (stop) return;
        const current = data.job;
        if (current && current.project === watching.current) {
          setJob(current);
          if (current.phase === "done") {
            const kind: ProjectKind = current.kind === "clone" ? "repo" : current.fallback ? "empty" : (current.template ?? "empty");
            onPicked({ project: current.project, kind, note: current.message });
            return;
          }
          if (current.phase === "error") {
            setError(current.message ?? "That did not work. Try again.");
            return;
          }
        }
      } catch {
        // The box may be busy installing. Keep checking.
      }
      if (!stop) timer = window.setTimeout(() => void tick(), 2000);
    };
    timer = window.setTimeout(() => void tick(), 1000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [client, running, onPicked]);

  function problem(reason: unknown) {
    setError(reason instanceof BoxError && reason.kind === "request" ? reason.message : "Can't reach your box. Try again.");
  }

  async function create() {
    if (!validNewProjectName(name)) {
      setError("Use lowercase letters, numbers, - or _.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await client.createProject(name, template);
      watching.current = result.project;
      setJob({ kind: "create", project: result.project, template, phase: "running", startedAt: Date.now() });
    } catch (reason) {
      problem(reason);
    } finally {
      setPending(false);
    }
  }

  const clone = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const result = await client.cloneProject(url);
      setNeedsGitHub(false);
      if (result.existing) {
        onPicked({ project: result.project, kind: "repo" });
        return;
      }
      watching.current = result.project;
      setJob({ kind: "clone", project: result.project, phase: "running", startedAt: Date.now() });
    } catch (reason) {
      if (reason instanceof BoxError && reason.needsGitHub) setNeedsGitHub(true);
      else problem(reason);
    } finally {
      setPending(false);
    }
  }, [client, url, onPicked]);

  function back() {
    setError(null);
    setNeedsGitHub(false);
    onMode("choose");
  }

  if (running && job) {
    return (
      <div className="py-6 text-center" aria-live="polite">
        <Loader2 className="mx-auto h-7 w-7 animate-spin" aria-hidden />
        <h1 className="headline mt-5 text-3xl">{job.kind === "clone" ? "Copying your repo" : "Creating your project"}</h1>
        <p className="muted mt-2 text-sm">
          {job.kind === "clone"
            ? `Into ~/projects/${job.project}.`
            : job.template === "nextjs"
              ? "Setting up Next.js. About a minute."
              : `~/projects/${job.project}`}
        </p>
        <Elapsed since={job.startedAt} />
      </div>
    );
  }

  if (mode === "new") {
    const valid = validNewProjectName(name);
    return (
      <div>
        <BackLink onClick={back} />
        <h1 className="headline mt-4 text-3xl">New project</h1>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(toProjectName(event.target.value))}
              placeholder="my-bakery"
              aria-label="Project name"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
          </label>
          <div className="grid gap-2 text-sm" role="radiogroup" aria-label="Template">
            <span className="font-medium">Start from</span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "nextjs", label: "Next.js", hint: "A web app, ready to run" },
                  { id: "empty", label: "Empty", hint: "Just a folder" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={template === item.id}
                  onClick={() => setTemplate(item.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    template === item.id
                      ? "border-[color-mix(in_oklab,var(--fg)_45%,transparent)] bg-[var(--chip-fill)]"
                      : "border-[var(--chip-border)] hover:bg-[var(--chip-fill)]"
                  }`}
                >
                  <span className="block font-medium">{item.label}</span>
                  <span className="muted block text-xs">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p className="danger text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="btn-lg w-full" type="submit" disabled={pending || !valid}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Create project
          </Button>
        </form>
      </div>
    );
  }

  if (mode === "github") {
    const folder = repoFolder(url);
    return (
      <div>
        <BackLink onClick={back} />
        <h1 className="headline mt-4 text-3xl">Bring a GitHub repo</h1>
        {needsGitHub ? (
          <GitHubConnect client={client} onConnected={() => void clone()} onCancel={() => setNeedsGitHub(false)} />
        ) : (
          <form
            className="mt-6 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void clone();
            }}
          >
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/you/repo"
              aria-label="Repository link"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
            <p className="muted text-xs">{folder ? `Goes to ~/projects/${folder}` : "Public or private. Private ones ask you to connect GitHub."}</p>
            {error ? (
              <p className="danger text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Button className="btn-lg w-full" type="submit" disabled={pending || !folder}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Bring it in
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 className="headline text-center text-3xl">What are we working on?</h1>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <button type="button" className="glass-flat action-card min-h-0 gap-6 !rounded-3xl" onClick={() => onMode("new")}>
          <span className="icon-blob">
            <Plus className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block font-medium tracking-tight">New project</span>
            <span className="muted text-sm">Start from scratch</span>
          </span>
        </button>
        <button type="button" className="glass-flat action-card min-h-0 gap-6 !rounded-3xl" onClick={() => onMode("github")}>
          <span className="icon-blob">
            <GitHubIcon />
          </span>
          <span>
            <span className="block font-medium tracking-tight">GitHub repo</span>
            <span className="muted text-sm">Bring your code</span>
          </span>
        </button>
      </div>
      {projects === null ? (
        <div className="mt-6 grid place-items-center">
          <Loader2 className="muted h-4 w-4 animate-spin" aria-label="Loading projects" />
        </div>
      ) : projects.length > 0 ? (
        <div className="mt-7">
          <p className="muted px-1 text-sm">Or continue one</p>
          <ul className="mt-2 grid gap-1.5">
            {projects.slice(0, 8).map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--chip-border)] px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--chip-fill)]"
                  onClick={() => onPicked({ project: item.name, kind: "existing" })}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Folder className="muted h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate font-medium">{item.name}</span>
                  </span>
                  <ChevronRight className="muted h-4 w-4 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="muted -ml-1 inline-flex items-center gap-1 text-sm hover:text-[var(--fg)]" onClick={onClick}>
      <ChevronLeft className="h-4 w-4" aria-hidden /> Back
    </button>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return <p className="muted mt-4 font-mono text-xs tabular-nums">{seconds}s</p>;
}

/** GitHub's device flow, run by `gh auth login` on the box: show the code, wait. */
function GitHubConnect({ client, onConnected, onCancel }: { client: BoxClient; onConnected: () => void; onCancel: () => void }) {
  const [login, setLogin] = useState<LoginState | null>(null);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = starting || (login !== null && ACTIVE.has(login.phase));

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const next = await client.status();
        if (stop) return;
        const state = next.login?.tool === "github" ? next.login : null;
        if (state?.phase === "done" || (!state && next.gh.loggedIn)) {
          onConnected();
          return;
        }
        setLogin(state ?? { tool: "github", phase: "error", message: "GitHub sign-in stopped. Try again." });
        if (state && !ACTIVE.has(state.phase)) return;
      } catch {
        // Try again on the next tick.
      }
      if (!stop) timer = window.setTimeout(() => void tick(), 2500);
    };
    timer = window.setTimeout(() => void tick(), 1500);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [client, active, onConnected]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await client.startLogin("github");
      const next = await client.status();
      setLogin(next.login?.tool === "github" ? next.login : { tool: "github", phase: "starting" });
    } catch (reason) {
      setError(reason instanceof BoxError && reason.kind === "request" ? reason.message : "Can't reach your box. Try again.");
    } finally {
      setStarting(false);
    }
  }

  async function copyAndOpen() {
    if (login?.code) await navigator.clipboard?.writeText(login.code).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    if (login?.url && !client.demo) window.open(login.url, "_blank", "noopener,noreferrer");
  }

  async function cancel() {
    if (login && ACTIVE.has(login.phase)) await client.cancelLogin().catch(() => undefined);
    onCancel();
  }

  if (login?.phase === "open_url" && login.code) {
    return (
      <div className="mt-6 text-center">
        <p className="muted text-sm">Your GitHub code</p>
        <p className="mt-2 select-all font-mono text-4xl font-semibold tracking-[0.12em]">{login.code}</p>
        <Button className="btn-lg mt-6 w-full" onClick={() => void copyAndOpen()}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          Copy code and open GitHub
        </Button>
        <p className="muted mt-4 text-sm">Paste it there and approve.{client.demo ? " Demo: this finishes by itself." : null}</p>
        <Waiting label="Waiting for GitHub" />
        <button type="button" className="btn-quiet mt-4 text-sm" onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 text-center">
      <span className="icon-blob mx-auto h-14 w-14">
        <GitHubIcon />
      </span>
      <p className="muted mx-auto mt-4 max-w-sm text-sm">
        Your box can&apos;t see that repo. If it&apos;s private, connect GitHub. You approve it on GitHub&apos;s own page.
      </p>
      {login?.phase === "error" || error ? (
        <p className="danger mt-3 text-sm" role="alert">
          {error ?? login?.message}
        </p>
      ) : null}
      {active ? (
        <Waiting label="Getting your code" />
      ) : (
        <Button className="btn-lg mt-6 w-full" onClick={() => void start()}>
          Connect GitHub
        </Button>
      )}
      <button type="button" className="btn-quiet mt-4 text-sm" onClick={() => void cancel()}>
        Use a different link
      </button>
    </div>
  );
}

// ---- step 3: what to build ----

export function TaskStep({
  client,
  status,
  picked,
  onChangeProject,
  onSignIn,
  onStarted,
}: {
  client: BoxClient;
  status: BoxStatus;
  picked: Picked;
  onChangeProject: () => void;
  onSignIn: () => void;
  onStarted: (started: Started) => void;
}) {
  const ready = (["claude", "codex"] as const).filter((item) => status[item].loggedIn);
  const [tool, setTool] = useState<Tool>(ready[0] ?? "claude");
  const [prompt, setPrompt] = useState("");
  const [autoApprove, setAutoApprove] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = TOOL_NAME[tool];
  const fresh = picked.kind === "nextjs" || picked.kind === "empty";
  const examples = EXAMPLES[picked.kind === "nextjs" ? "nextjs" : picked.kind === "empty" ? "empty" : "repo"];

  if (ready.length === 0) {
    return (
      <div className="py-4 text-center">
        <h1 className="headline text-3xl">Sign in first</h1>
        <p className="muted mt-2 text-sm">Connect Claude or ChatGPT, then come back here.</p>
        <Button className="btn-lg mt-8 w-full" onClick={onSignIn}>
          Sign in
        </Button>
      </div>
    );
  }

  async function submit() {
    const text = prompt.trim();
    if (!text) return;
    setPending(true);
    setError(null);
    try {
      const result = await client.startSession({ project: picked.project, prompt: text, tool, autoApprove });
      onStarted({ name: result.name, project: picked.project, tool });
    } catch (reason) {
      setError(reason instanceof BoxError && reason.kind === "request" ? reason.message : "Can't reach your box. Try again.");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="chip max-w-[70%] gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{picked.project}</span>
        </span>
        <button type="button" className="muted text-sm hover:text-[var(--fg)]" onClick={onChangeProject}>
          Change
        </button>
      </div>
      <h1 className="headline mt-5 text-3xl">{fresh ? `What should ${name} build first?` : `What should ${name} do?`}</h1>
      {picked.note ? <p className="muted mt-2 text-sm">{picked.note}</p> : null}

      {ready.length > 1 ? (
        <div className="mt-5 inline-flex rounded-full border border-[var(--chip-border)] bg-[var(--chip-fill)] p-1" role="radiogroup" aria-label="Tool">
          {ready.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={tool === item}
              onClick={() => setTool(item)}
              className={`inline-flex h-8 items-center rounded-full px-4 text-sm font-medium transition-colors ${
                tool === item ? "[background:var(--accent)] text-[var(--accent-fg)] shadow-[var(--accent-shadow)]" : "muted hover:text-[var(--fg)]"
              }`}
            >
              {TOOL_NAME[item]}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Describe it in plain words"
        aria-label={`Task for ${name}`}
        maxLength={6000}
        rows={4}
        className="field mt-5 h-auto min-h-32 resize-y py-3 leading-relaxed"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            className="rounded-full border border-[var(--chip-border)] px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--chip-fill)]"
            onClick={() => setPrompt(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(event) => setAutoApprove(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--signal)]"
        />
        <span>
          Let {name} work without asking for permission
          <span className="muted block text-xs">Recommended. It&apos;s your private box.</span>
        </span>
      </label>

      {error ? (
        <p className="danger mt-4 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="btn-lg mt-6 w-full" type="submit" disabled={pending || !prompt.trim()}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Start
      </Button>
    </form>
  );
}

export function StartedView({ started, onAnother }: { started: Started; onAnother: () => void }) {
  const name = TOOL_NAME[started.tool];
  return (
    <div className="py-2 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[color-mix(in_oklab,var(--signal)_18%,transparent)]">
        <Check className="signal h-7 w-7" aria-hidden />
      </span>
      <h1 className="headline mt-5 text-3xl">
        {name} is working on {started.project}
      </h1>
      <p className="muted mx-auto mt-3 max-w-sm text-sm">It keeps running when you close this tab. Check from your phone.</p>
      <div className="mt-8 grid gap-3">
        <Button asChild className="btn-lg w-full">
          <Link href={`/terminal?session=${encodeURIComponent(started.name)}`}>
            <Eye className="h-4 w-4" aria-hidden /> Watch live
          </Link>
        </Button>
        <Button asChild variant="ghost" className="btn-lg w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
      <button type="button" className="btn-quiet mt-5 text-sm" onClick={onAnother}>
        Start another task
      </button>
    </div>
  );
}
