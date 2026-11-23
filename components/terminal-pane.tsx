"use client";

import { LiveTerminal } from "@/components/live-terminal";
import { MockTerminal, type TerminalHandle } from "@/components/mock-terminal";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Ref } from "react";

type Flow = "shell" | "claude" | "codex";

export function TerminalPane({
  mode,
  handle,
  projects = [],
  session,
  onStatus,
}: {
  mode: Flow;
  handle?: Ref<TerminalHandle>;
  projects?: string[];
  /** A task session to attach to instead of the shared one. */
  session?: string;
  onStatus?: (status: "connecting" | "open" | "closed") => void;
}) {
  const router = useRouter();
  const [demo, setDemo] = useState<boolean | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { user: unknown; mock: boolean }) => {
        if (cancel) return;
        if (!data.user) {
          router.replace("/login");
          return;
        }
        setDemo(Boolean(data.mock));
        if (data.mock) onStatus?.("open");
      })
      .catch(() => {
        if (!cancel) setDemo(true);
      });
    return () => {
      cancel = true;
    };
  }, [onStatus, router]);

  if (demo === null) return <div className="h-full w-full bg-[#0c0c0e]" />;
  if (demo) return <MockTerminal mode={mode} handle={handle} projects={projects} session={session} />;
  return <LiveTerminal mode={mode} handle={handle} onStatus={onStatus} session={session} />;
}
