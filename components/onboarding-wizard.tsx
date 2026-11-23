"use client";

import { OrbitIcon, SparkIcon } from "@/components/icons";
import { TerminalPane } from "@/components/terminal-pane";
import type { TerminalHandle } from "@/components/mock-terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BoxError,
  cleanCode,
  connectBox,
  LATEST_AGENT_VERSION,
  planLabel,
  type BoxClient,
  type BoxProblem,
  type BoxStatus,
  type LoginState,
  type Tool,
} from "@/lib/box-client";
import { SUPPORT_EMAIL } from "@/lib/links";
import { Check, ChevronLeft, Copy, ExternalLink, Loader2, Smartphone, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const NAMES: Record<Tool, { name: string; product: string; plans: string }> = {
  claude: { name: "Claude", product: "Claude Code", plans: "your Claude Pro or Max plan" },
  codex: { name: "ChatGPT", product: "Codex", plans: "your ChatGPT Plus or Pro plan" },
};

const ACTIVE = new Set(["starting", "open_url", "waiting_code", "verifying"]);

export function OnboardingWizard({ initialTool }: { initialTool?: Tool }) {
  const router = useRouter();
  const [client, setClient] = useState<BoxClient | null>(null);
  const [status, setStatus] = useState<BoxStatus | null>(null);
  const [problem, setProblem] = useState<BoxProblem | null>(null);
  const [tool, setTool] = useState<Tool>(initialTool ?? "claude");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const popup = useRef<Window | null>(null);
  const opened = useRef<string | null>(null);
  const pickedTool = useRef(Boolean(initialTool));

  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof BoxError) {
        if (reason.kind === "signed-out") return router.replace("/login?next=%2Fstart");
        if (reason.kind === "no-box") return router.replace("/dashboard");
        if (reason.kind === "request") return setError(reason.message);
        return setProblem(reason.kind);
      }
      setProblem("unreachable");
    },
    [router],
  );

  // First load: connect, read the box state once.
  useEffect(() => {
    let cancel = false;
    connectBox()
      .then(async (next) => {
        const first = await next.status();
        if (cancel) return;
        setClient(next);
        setStatus(first);
        if (first.login && ACTIVE.has(first.login.phase)) setTool(first.login.tool);
        else if (!pickedTool.current && !first.claude.loggedIn && first.codex.loggedIn) setTool("codex");
      })
      .catch((reason) => {
        if (!cancel) fail(reason);
      });
    return () => {
      cancel = true;
    };
  }, [fail, attempt]);

  const login: LoginState | null = status?.login?.tool === tool ? status.login : null;
  const phase = login?.phase ?? null;
  const waiting = starting || (phase !== null && ACTIVE.has(phase));

  // Poll only while a sign-in is in flight, gently, and never in a hidden tab.
  useEffect(() => {
    if (!client || !waiting) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.hidden) return;
      try {
        const next = await client.status();
        if (stop) return;
        setStatus(next);
      } catch (reason) {
        if (!stop) fail(reason);
        return;
      }
      const fast = phase === "starting" || phase === "verifying" || phase === null;
      timer = window.setTimeout(() => void tick(), fast ? 1500 : 3000);
    };
    const onVisible = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void tick();
    };
    timer = window.setTimeout(() => void tick(), 1200);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, waiting, phase, fail]);

  // Send the tab opened on click to the sign-in page as soon as the box has the URL.
  useEffect(() => {
    if (tool !== "claude" || !login?.url || opened.current === login.url) return;
    const tab = popup.current;
    if (tab && !tab.closed) {
      tab.location.href = login.url;
      opened.current = login.url;
    }
  }, [tool, login?.url]);

  // A sign-in that failed before its page ever loaded leaves a blank tab behind.
  useEffect(() => {
    if (phase === "error" && popup.current && !popup.current.closed && opened.current === null) popup.current.close();
  }, [phase]);

  async function start() {
    if (!client) return;
    setError(null);
    setCode("");
    opened.current = null;
    popup.current = null;
    // Open the tab inside the click so popup blockers allow it; it gets its URL later.
    // Codex shows a code to copy first, so it opens its page from a second click.
    if (tool === "claude" && !client.demo) {
      const tab = window.open("", "_blank");
      if (tab) {
        try {
          tab.opener = null;
          tab.document.title = "Opening Claude";
          tab.document.body.style.cssText = "font:16px system-ui;padding:40px;color:#888";
          tab.document.body.textContent = "Opening Claude sign-in...";
        } catch {
          // Cosmetic only.
        }
      }
      popup.current = tab;
    }
    setStarting(true);
    try {
      await client.startLogin(tool);
      setStatus(await client.status());
    } catch (reason) {
      popup.current?.close();
      fail(reason);
    } finally {
      setStarting(false);
    }
  }

  async function submitCode() {
    if (!client) return;
    const clean = cleanCode(code);
    if (!clean) {
      setError("Paste the whole code from the Claude page.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      await client.sendCode(clean);
      setCode("");
      setStatus(await client.status());
    } catch (reason) {
      fail(reason);
    } finally {
      setSending(false);
    }
  }

  async function restart() {
    if (!client) return;
    await client.cancelLogin().catch(() => undefined);
    setStatus(await client.status().catch(() => status));
    setError(null);
  }

  async function copyAndOpen(state: LoginState) {
    if (state.code) await navigator.clipboard?.writeText(state.code).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    if (state.url && !client?.demo) window.open(state.url, "_blank", "noopener,noreferrer");
  }

  async function launch() {
    if (!client) return;
    setLaunching(true);
    try {
      await client.openTool(tool);
    } catch {
      // The terminal still opens; the user can type the command there.
    }
    router.push("/terminal");
  }

  async function updateBox() {
    if (!client) return;
    setUpdating(true);
    try {
      await client.update();
    } catch (reason) {
      fail(reason);
    }
    // The agent restarts during the update. Check again in a little while.
    window.setTimeout(() => {
      setUpdating(false);
      setAttempt((value) => value + 1);
    }, 25_000);
  }

  function pick(next: Tool) {
    pickedTool.current = true;
    setTool(next);
    setError(null);
  }

  const names = NAMES[tool];
  const toolStatus = status?.[tool];
  const connected = Boolean(toolStatus?.loggedIn) && !waiting;

  if (problem === "legacy") return <LegacyFlow tool={tool} onPick={pick} />;

  return (
    <main className="grid min-h-dvh place-items-center px-4 pb-12 pt-24 sm:px-5">
      <div className="rise w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <Link href="/dashboard" className="icon-btn -ml-2" aria-label="Dashboard">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <Steps current={connected ? 2 : 1} />
        </div>

        <section className="glass px-6 py-8 sm:px-10 sm:py-10">
          {problem ? (
            <Problem
              kind={problem}
              onRetry={() => {
                setProblem(null);
                setAttempt((value) => value + 1);
              }}
            />
          ) : !status ? (
            <div className="grid place-items-center py-16" aria-live="polite">
              <Loader2 className="muted h-6 w-6 animate-spin" aria-label="Checking your box" />
            </div>
          ) : (
            <>
              <ToolSwitch tool={tool} onPick={pick} disabled={starting || sending} status={status} />

              {status.version < LATEST_AGENT_VERSION ? (
                <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[var(--chip-border)] bg-[var(--chip-fill)] px-4 py-3 text-sm">
                  <span>{updating ? "Updating your box. About a minute." : "A box update is ready."}</span>
                  <Button size="sm" variant="ghost" disabled={updating} onClick={() => void updateBox()}>
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
                  </Button>
                </div>
              ) : null}

              {connected ? (
                <Connected tool={tool} email={toolStatus?.email} plan={toolStatus?.plan} launching={launching} onLaunch={() => void launch()} />
              ) : toolStatus && !toolStatus.installed ? (
                <div className="mt-8 text-center">
                  <h1 className="headline text-3xl">{names.product} is missing</h1>
                  <p className="muted mt-3 text-sm">
                    It did not install on your box. Email{" "}
                    <a className="underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
                      {SUPPORT_EMAIL}
                    </a>{" "}
                    and we will fix it.
                  </p>
                </div>
              ) : (
                <div className="mt-8">
                  <div className="text-center">
                    <span className="icon-blob mx-auto h-14 w-14">{tool === "claude" ? <SparkIcon /> : <OrbitIcon />}</span>
                    <h1 className="headline mt-5 text-3xl">Sign in to {names.name}</h1>
                    <p className="muted mx-auto mt-2 max-w-sm text-sm">
                      Use {names.plans}. You sign in on {tool === "claude" ? "Anthropic" : "OpenAI"}&apos;s own page, and the login stays on your box.
                    </p>
                  </div>

                  {phase === "starting" || (starting && !login) ? (
                    <Waiting label="Getting your sign-in link" />
                  ) : phase === "open_url" && login ? (
                    <CodexCode login={login} copied={copied} onCopy={() => void copyAndOpen(login)} demo={client?.demo} />
                  ) : (phase === "waiting_code" || phase === "verifying") && login ? (
                    <ClaudeCode
                      login={login}
                      code={code}
                      onCode={setCode}
                      sending={sending || phase === "verifying"}
                      onSubmit={() => void submitCode()}
                      demo={client?.demo}
                    />
                  ) : (
                    <div className="mt-8 grid gap-3">
                      {phase === "error" && login?.message ? (
                        <p className="danger text-center text-sm" role="alert">
                          {login.message}
                        </p>
                      ) : null}
                      <Button className="btn-lg w-full" onClick={() => void start()} disabled={!client || starting}>
                        {phase === "error" ? "Try again" : `Sign in with ${names.name}`}
                      </Button>
                    </div>
                  )}

                  {error ? (
                    <p className="danger mt-4 text-center text-sm" role="alert">
                      {error}
                    </p>
                  ) : null}

                  {phase && ACTIVE.has(phase) && phase !== "starting" ? (
                    <div className="mt-6 text-center">
                      <button type="button" className="btn-quiet text-sm" onClick={() => void restart()}>
                        Start over
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>

        <div className="mt-4 flex items-center justify-center gap-5 text-sm">
          <Link href="/terminal" className="muted inline-flex items-center gap-1.5 hover:text-[var(--fg)]">
            <Terminal className="h-4 w-4" /> Open terminal
          </Link>
          <Link href="/dashboard" className="muted hover:text-[var(--fg)]">
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

function Steps({ current }: { current: 1 | 2 }) {
  const items = ["Sign in", "Start building"];
  return (
    <ol className="flex items-center gap-3 text-sm" aria-label="Setup steps">
      {items.map((label, index) => {
        const n = index + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className={`flex items-center gap-2 ${active || done ? "" : "muted"}`} aria-current={active ? "step" : undefined}>
            <span
              className={`step-num h-6 w-6 text-xs ${active ? "border-transparent [background:var(--accent)] text-[var(--accent-fg)]" : ""}`}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
            </span>
            <span className="font-medium">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ToolSwitch({ tool, onPick, disabled, status }: { tool: Tool; onPick: (tool: Tool) => void; disabled: boolean; status: BoxStatus }) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex rounded-full border border-[var(--chip-border)] bg-[var(--chip-fill)] p-1" role="tablist">
        {(["claude", "codex"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tool === item}
            disabled={disabled && tool !== item}
            onClick={() => onPick(item)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
              tool === item ? "[background:var(--accent)] text-[var(--accent-fg)] shadow-[var(--accent-shadow)]" : "muted hover:text-[var(--fg)]"
            }`}
          >
            {status[item].loggedIn ? <Check className="h-3.5 w-3.5" aria-label="connected" /> : null}
            {NAMES[item].name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-sm" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  );
}

function ClaudeCode({
  login,
  code,
  onCode,
  sending,
  onSubmit,
  demo,
}: {
  login: LoginState;
  code: string;
  onCode: (value: string) => void;
  sending: boolean;
  onSubmit: () => void;
  demo?: boolean;
}) {
  return (
    <div className="mt-8">
      <ol className="grid gap-2 text-sm">
        <li className="flex items-start gap-3">
          <span className="step-num h-6 w-6 text-xs">1</span>
          <span className="pt-0.5">
            Sign in on the Claude page.{" "}
            {login.url && !demo ? (
              <a href={login.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                Open sign-in page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="step-num h-6 w-6 text-xs">2</span>
          <span className="pt-0.5">Copy the code Claude shows you and paste it here.</span>
        </li>
      </ol>
      <form
        className="mt-5 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Input
          value={code}
          onChange={(event) => onCode(event.target.value)}
          placeholder={demo ? "Demo: type anything" : "Paste code"}
          aria-label="Code from Claude"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={sending}
          className="text-center font-mono"
        />
        <Button className="btn-lg w-full" disabled={sending || !code.trim()} type="submit">
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Connecting
            </>
          ) : (
            "Connect"
          )}
        </Button>
      </form>
    </div>
  );
}

function CodexCode({ login, copied, onCopy, demo }: { login: LoginState; copied: boolean; onCopy: () => void; demo?: boolean }) {
  return (
    <div className="mt-8 text-center">
      <p className="muted text-sm">Your one-time code</p>
      <p className="mt-2 select-all font-mono text-4xl font-semibold tracking-[0.12em]">{login.code}</p>
      <Button className="btn-lg mt-6 w-full" onClick={onCopy}>
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        Copy code and open ChatGPT
      </Button>
      <p className="muted mt-4 text-sm">
        Enter the code on that page.{demo ? " Demo: this finishes by itself." : null}
      </p>
      {login.url && !demo ? (
        <a href={login.url} target="_blank" rel="noopener noreferrer" className="muted mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2">
          {login.url.replace(/^https:\/\//, "")} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
      <Waiting label="Waiting for you to finish" />
    </div>
  );
}

function Connected({
  tool,
  email,
  plan,
  launching,
  onLaunch,
}: {
  tool: Tool;
  email?: string;
  plan?: string;
  launching: boolean;
  onLaunch: () => void;
}) {
  const names = NAMES[tool];
  const detail = [email, planLabel(plan)].filter(Boolean).join(" · ");
  return (
    <div className="mt-8 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[color-mix(in_oklab,var(--signal)_18%,transparent)]">
        <Check className="signal h-7 w-7" aria-hidden />
      </span>
      <h1 className="headline mt-5 text-3xl">{names.name} is connected</h1>
      {detail ? <p className="muted mt-2 text-sm">{detail}</p> : null}
      <Button className="btn-lg mt-8 w-full" onClick={onLaunch} disabled={launching}>
        {launching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Start {names.product}
      </Button>
      <p className="muted mt-4 text-sm">
        It opens in your projects folder. Tell it what to build.
      </p>
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[var(--chip-border)] bg-[var(--chip-fill)] px-4 py-3 text-left text-sm">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium">Runs even when you close this tab.</span>{" "}
          <span className="muted">Check in from your phone anytime. Next up here: one tap to start a project or bring in a GitHub repo.</span>
        </span>
      </div>
    </div>
  );
}

function Problem({ kind, onRetry }: { kind: BoxProblem; onRetry: () => void }) {
  const copy =
    kind === "blocked"
      ? { title: "Your box is up", text: "But this page could not talk to it. The terminal still works." }
      : { title: "Can't reach your box", text: "It may be starting or restarting. This usually sorts itself out in a minute." };
  return (
    <div className="py-6 text-center">
      <h1 className="headline text-3xl">{copy.title}</h1>
      <p className="muted mx-auto mt-3 max-w-sm text-sm">{copy.text}</p>
      <Button className="mt-8" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Boxes from before agent v2 cannot sign in for you. Show the terminal, honestly. */
function LegacyFlow({ tool, onPick }: { tool: Tool; onPick: (tool: Tool) => void }) {
  const handle = useRef<TerminalHandle>(null);
  const names = NAMES[tool];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 px-3 pt-22 pb-3 sm:pt-23 lg:h-dvh lg:min-h-[34rem] lg:flex-row lg:px-4">
      <aside className="glass flex shrink-0 flex-col gap-4 p-5 lg:w-80">
        <div className="flex items-center gap-1">
          <Link href="/dashboard" className="icon-btn -ml-2 shrink-0" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Your box needs a quick update</h1>
        </div>
        <p className="muted text-sm">
          One-tap sign-in is not on your box yet. We are updating it. Until then, sign in from the terminal.
        </p>
        <div className="flex gap-2">
          {(["claude", "codex"] as const).map((item) => (
            <Button key={item} size="sm" variant={tool === item ? "default" : "ghost"} className="flex-1" onClick={() => onPick(item)}>
              {NAMES[item].name}
            </Button>
          ))}
        </div>
        <ol className="grid gap-2 text-sm">
          <li>
            1. Tap <span className="font-medium">Start</span>. The terminal runs {tool === "claude" ? "claude" : "codex login --device-auth"}.
          </li>
          <li>2. {tool === "claude" ? "Open the link it prints, sign in, and paste the code back into the terminal." : "Open the link it prints and enter the code it shows."}</li>
        </ol>
        <Button size="sm" onClick={() => handle.current?.start()}>
          Start {names.product}
        </Button>
      </aside>
      <section className="glass relative min-h-72 flex-1 overflow-hidden lg:min-h-0">
        <div className="absolute inset-0 bg-[#0c0c0e] p-3 sm:p-4">
          <TerminalPane mode={tool === "claude" ? "claude" : "codex"} handle={handle} />
        </div>
      </section>
    </main>
  );
}
