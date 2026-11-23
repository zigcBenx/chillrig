"use client";

import { PreviewAccess, previewStateLabel } from "@/components/preview-access";
import { useBoxUpdate } from "@/components/start-steps";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  BoxError,
  previewHref,
  TASKS_AGENT_VERSION,
  type BoxClient,
  type BoxStatus,
  type PreviewStatus,
  type Session,
} from "@/lib/box-client";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const TOOL_NAME = { claude: "Claude", codex: "Codex" } as const;
const POLL_MS = 10_000;

/** Tasks running on the box. Polls the box directly, only while this tab is visible. */
export function SessionsCard({ client, status, onStatus }: { client: BoxClient; status: BoxStatus; onStatus: (status: BoxStatus) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [preview, setPreview] = useState<PreviewStatus | null>(null);
  const [stopping, setStopping] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const supported = status.version >= TASKS_AGENT_VERSION;

  useEffect(() => {
    if (!supported) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      window.clearTimeout(timer);
      if (stop || document.hidden) return;
      try {
        const next = await client.sessions();
        if (stop) return;
        setSessions(next.sessions);
        setPreview(next.preview);
        setNow(Date.now());
        setError(null);
      } catch {
        if (!stop) setError("Can't reach your box right now.");
      }
      if (!stop) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, supported]);

  async function confirmStop() {
    if (!stopping) return;
    setPending(true);
    try {
      await client.stopSession(stopping.name);
      setSessions((list) => list?.filter((item) => item.name !== stopping.name) ?? null);
      setStopping(null);
    } catch (reason) {
      setError(reason instanceof BoxError && reason.kind === "request" ? reason.message : "Could not stop it. Try again.");
      setStopping(null);
    } finally {
      setPending(false);
    }
  }

  if (!supported) return <UpdateCard client={client} onStatus={onStatus} />;

  const latest = sessions?.[0]?.project;
  const newTask = latest ? `/start?step=task&project=${encodeURIComponent(latest)}` : "/start";

  return (
    <section className="glass mt-3 p-5 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Tasks</h2>
        <Button asChild size="sm">
          <Link href={newTask}>
            <Plus className="h-4 w-4" aria-hidden /> New task
          </Link>
        </Button>
      </div>

      {sessions === null && !error ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="muted h-5 w-5 animate-spin" aria-label="Loading tasks" />
        </div>
      ) : sessions && sessions.length === 0 ? (
        <p className="muted mt-3 text-sm">Nothing running yet.</p>
      ) : null}

      {sessions && sessions.length > 0 ? (
        <ul className="mt-4 grid gap-3">
          {sessions.map((session) => (
            <li key={session.name} className="rounded-3xl border border-[var(--chip-border)] bg-[var(--chip-fill)] p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StateBadge state={session.state} />
                <span className="min-w-0 truncate font-medium">{session.project || session.name}</span>
                <span className="muted text-xs">
                  {TOOL_NAME[session.tool]} · {ago(session.startedAt, now)}
                </span>
              </div>
              {session.title ? <p className="muted mt-1.5 line-clamp-2 text-sm">{session.title}</p> : null}
              {/* The tool's last message. The raw output stays behind Open (the terminal). */}
              {session.summary ? <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-relaxed">{session.summary}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button asChild size="sm">
                  <Link href={`/terminal?session=${encodeURIComponent(session.name)}`}>Open</Link>
                </Button>
                {session.project ? (
                  <Button asChild size="sm" variant="ghost">
                    <a href={previewHref(session.project)} target="_blank" rel="noopener">
                      Open preview <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </Button>
                ) : null}
                {session.project ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/start?step=task&project=${encodeURIComponent(session.project)}`}>New task</Link>
                  </Button>
                ) : null}
                <Button size="sm" variant="quiet" className="ml-auto" onClick={() => setStopping(session)}>
                  {session.state === "finished" ? "Close" : "Stop"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="muted mt-3 text-sm">{error}</p> : null}

      {preview && preview.state !== "none" ? (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[var(--chip-border)] pt-4">
          <div className="min-w-0 text-sm">
            <Link href="/preview" className="font-medium hover:underline">
              Preview
            </Link>
            <span className="muted">
              {" "}
              · {preview.project ?? "no project"} · {previewStateLabel(preview)}
            </span>
            {preview.state === "error" && preview.message ? <p className="muted mt-1 text-xs">{preview.message}</p> : null}
            {preview.state === "stopped" && preview.output ? (
              <p className="muted mt-1 text-xs">
                It stopped.{" "}
                <Link href="/terminal?session=chillrig-preview" className="underline underline-offset-2">
                  See why
                </Link>
              </p>
            ) : null}
          </div>
          <PreviewAccess client={client} preview={preview} onChange={setPreview} />
        </div>
      ) : null}

      <Dialog open={stopping !== null} onOpenChange={(open) => (open ? undefined : setStopping(null))}>
        <DialogContent
          title={stopping?.state === "finished" ? "Close this task?" : "Stop this task?"}
          description={`${stopping ? TOOL_NAME[stopping.tool] : "It"} stops and the session closes. Your files stay.`}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStopping(null)}>
              Keep
            </Button>
            <Button disabled={pending} onClick={() => void confirmStop()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {stopping?.state === "finished" ? "Close" : "Stop"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StateBadge({ state }: { state: Session["state"] }) {
  const look =
    state === "working"
      ? { dot: "pulse bg-[var(--signal)] shadow-[0_0_8px_var(--signal)]", label: "Working" }
      : state === "waiting"
        ? { dot: "bg-[#d6a15a]", label: "Waiting for you" }
        : { dot: "bg-[var(--muted)]", label: "Finished" };
  return (
    <span className="chip h-6 gap-1.5 px-2.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${look.dot}`} aria-hidden />
      {look.label}
    </span>
  );
}

function UpdateCard({ client, onStatus }: { client: BoxClient; onStatus: (status: BoxStatus) => void }) {
  const update = useBoxUpdate(client, onStatus);
  const busy = update.phase === "updating";
  return (
    <section className="glass mt-3 flex flex-wrap items-center justify-between gap-4 p-5 sm:p-8">
      <span>
        <span className="block text-lg font-semibold tracking-tight">Update your box</span>
        <span className="muted mt-1 block text-sm">
          {busy
            ? "Updating. About a minute. Your files and sessions stay."
            : update.phase === "slow"
              ? "Still updating. Check back in a few minutes."
              : (update.error ?? "Get a live preview of your app and clearer task updates.")}
        </span>
      </span>
      <Button size="sm" disabled={busy} onClick={() => void update.start()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busy ? "Updating" : "Update"}
      </Button>
    </section>
  );
}

function ago(at: number, now: number) {
  if (!at) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
