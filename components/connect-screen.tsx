"use client";

import { TerminalPane } from "@/components/terminal-pane";
import { Button } from "@/components/ui/button";
import type { TerminalHandle } from "@/components/mock-terminal";
import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

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
  // The sign-in happens inside the terminal, which we never read, so the
  // highlight is a place-marker: Start puts it on step 1, a tap moves it.
  const [current, setCurrent] = useState(0);

  function start() {
    setCurrent(0);
    handle.current?.start();
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 px-3 pt-22 pb-3 sm:pt-23 lg:h-dvh lg:min-h-[34rem] lg:flex-row lg:px-4">
      <aside className="glass flex shrink-0 flex-col gap-4 p-4 sm:p-5 lg:w-80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <Link href="/dashboard" className="icon-btn shrink-0" aria-label="Back">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="truncate text-lg font-semibold tracking-tight">{copy.title}</h1>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto lg:w-full">
            <Button size="sm" className="flex-1 sm:flex-none lg:flex-1" onClick={start}>
              Start
            </Button>
            <Button size="sm" variant="ghost" className="flex-1 sm:flex-none lg:flex-1" onClick={start}>
              Reconnect
            </Button>
          </div>
        </div>
        <ol className="grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-1">
          {copy.steps.map((step, index) => (
            <li key={step} className="min-w-0">
              <button
                type="button"
                className="step"
                aria-current={index === current ? "step" : undefined}
                // Keep the cursor in the terminal when a step is tapped.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setCurrent(index)}
              >
                <span className="step-num">
                  {index < current ? <Check className="signal h-3.5 w-3.5" aria-hidden /> : index + 1}
                </span>
                {step}
              </button>
            </li>
          ))}
        </ol>
        <p className="muted text-xs lg:mt-auto">{copy.note}</p>
      </aside>
      <section className="glass relative min-h-72 flex-1 overflow-hidden lg:min-h-0">
        <div className="absolute inset-0 bg-[#0c0c0e] p-3 sm:p-4">
          <TerminalPane mode={copy.mode} handle={handle} />
        </div>
      </section>
    </main>
  );
}
