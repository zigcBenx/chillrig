"use client";

import { TerminalPane } from "@/components/terminal-pane";
import { validSessionName } from "@/lib/box-client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/** The terminal page. `session` attaches to a task session (checked again on the box). */
export function TerminalScreen({ session, waiting = false }: { session?: string; waiting?: boolean }) {
  const attach = validSessionName(session) ? session : undefined;
  return (
    <main className="flex h-dvh flex-col px-3 pt-20 pb-3">
      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-2 py-2">
          <Link href="/dashboard" className="icon-btn" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <span className="truncate text-sm font-medium">{attach ? `Task · ${attach.replace(/^cr-/, "")}` : "Terminal"}</span>
        </div>
        <div className="min-h-0 flex-1 bg-[#0c0c0e]">{waiting ? null : <TerminalPane mode="shell" session={attach} />}</div>
      </section>
    </main>
  );
}
