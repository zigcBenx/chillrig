"use client";

import { TerminalPane } from "@/components/terminal-pane";
import { Button } from "@/components/ui/button";
import type { TerminalHandle } from "@/components/mock-terminal";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

const COPY = {
  claude: {
    title: "Claude",
    mode: "claude" as const,
    note: "Official CLI on your box.",
    steps: ["Open link", "Sign in", "Paste code"],
  },
  chatgpt: {
    title: "ChatGPT",
    mode: "codex" as const,
    note: "Official CLI on your box.",
    steps: ["Open link", "Enter code", "Done"],
  },
};

export function ConnectScreen({ kind }: { kind: "claude" | "chatgpt" }) {
  const copy = COPY[kind];
  const handle = useRef<TerminalHandle>(null);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-3 px-3 pt-20 pb-3 md:flex-row md:px-4">
      <aside className="glass shrink-0 p-4 md:flex md:w-72 md:flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="icon-btn" aria-label="Back">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handle.current?.start()}>
              Start
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handle.current?.start()}>
              Reconnect
            </Button>
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-1">
          {copy.steps.map((step, index) => (
            <li key={step} className="rounded-2xl bg-black/5 px-3 py-3 text-sm dark:bg-white/5">
              <span className="muted mr-2">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="muted mt-4 text-xs">{copy.note}</p>
      </aside>
      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-[46vh] flex-1 bg-[#0c0c0e] md:min-h-0">
          <TerminalPane mode={copy.mode} handle={handle} />
        </div>
      </section>
    </main>
  );
}
