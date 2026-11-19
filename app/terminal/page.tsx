import type { Metadata } from "next";
import { TerminalScreen } from "@/components/terminal-screen";

export const metadata: Metadata = { title: "Terminal" };

export default function TerminalPage() {
  return <TerminalScreen />;
}
