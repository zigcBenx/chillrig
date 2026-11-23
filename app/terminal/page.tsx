import type { Metadata } from "next";
import { Suspense } from "react";
import { TerminalScreen } from "@/components/terminal-screen";

export const metadata: Metadata = { title: "Terminal" };

/** /terminal attaches to the shared session; /terminal?session=<name> to a task session. */
export default function TerminalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<TerminalScreen waiting />}>
      <AttachedTerminal searchParams={searchParams} />
    </Suspense>
  );
}

async function AttachedTerminal({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { session } = await searchParams;
  return <TerminalScreen session={typeof session === "string" ? session : undefined} />;
}
