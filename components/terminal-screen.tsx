"use client";

import { TerminalPane } from "@/components/terminal-pane";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function TerminalScreen() {
  return (
    <main className="flex h-dvh flex-col px-3 pt-20 pb-3">
      <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-2 py-2">
          <Link href="/dashboard" className="icon-btn" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <span className="text-sm font-medium">Terminal</span>
        </div>
        <div className="min-h-0 flex-1 bg-[#0c0c0e]">
          <TerminalPane mode="shell" />
        </div>
      </section>
    </main>
  );
}
