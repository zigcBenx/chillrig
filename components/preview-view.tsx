"use client";

import { PreviewAccess, previewStateLabel } from "@/components/preview-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/components/use-account";
import { connectBox, previewHref, type BoxClient, type PreviewStatus } from "@/lib/box-client";
import { ChevronLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export function PreviewView() {
  const { data } = useAccount(8000);
  const [port, setPort] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [client, setClient] = useState<BoxClient | null>(null);
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const running = data?.box?.status === "running";
  const shownPort = port ?? String(status?.port ?? data?.box?.appPort ?? 3000);

  // One look at the preview (public or private, which project). Not a poll.
  useEffect(() => {
    if (!running) return;
    let cancel = false;
    connectBox()
      .then(async (next) => {
        const preview = await next.preview();
        if (cancel) return;
        setClient(next);
        setStatus(preview);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [running]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/boxes/port", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ port: Number(shownPort) }),
    });
    const body = (await response.json()) as { error?: string };
    setPending(false);
    setMessage(response.ok ? "Saved" : body.error ?? "Could not save");
    if (response.ok && client) setStatus(await client.preview().catch(() => status));
  }

  const hostname = data?.box?.hostname;
  // The frame opens through the control plane too: the box sets a cookie made for frames.
  const preview = data?.previewUrl ? previewHref() : null;

  return (
    <main className="flex h-dvh flex-col px-3 pt-20 pb-3">
      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3">
          <Link href="/dashboard" className="icon-btn" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex gap-1.5 px-1" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffb4a8]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffe0a3]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#b8e6c8]" />
          </div>
          <p className="muted min-w-0 flex-1 truncate text-sm">{hostname ?? "box"}</p>
          {preview ? (
            <a className="icon-btn" href={previewHref(status?.project)} target="_blank" rel="noopener" aria-label="Open preview">
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <form className="flex items-center gap-2" onSubmit={(event) => void save(event)}>
            <Input
              className="h-9 w-24"
              inputMode="numeric"
              aria-label="Port"
              value={shownPort}
              onChange={(event) => setPort(event.target.value)}
            />
            <Button size="sm" disabled={pending}>
              Save
            </Button>
          </form>
        </div>
        {client && status ? (
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3">
            <p className="muted text-sm">
              {status.project ?? "No project yet"} · {previewStateLabel(status)}
              {status.state === "error" && status.message ? <span className="block text-xs">{status.message}</span> : null}
            </p>
            <PreviewAccess client={client} preview={status} onChange={setStatus} />
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1 bg-white/70 dark:bg-black/30">
          {preview ? (
            <iframe title="App preview" src={preview} className="h-full w-full border-0 bg-white" />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="text-lg font-medium tracking-tight">Waiting</p>
                <p className="muted mt-2 text-sm">Port {shownPort}</p>
              </div>
            </div>
          )}
        </div>
        {message ? <p className="muted px-4 py-2 text-xs">{message}</p> : null}
      </section>
    </main>
  );
}
