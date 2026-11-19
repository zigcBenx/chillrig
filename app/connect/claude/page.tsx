import type { Metadata } from "next";
import { ConnectScreen } from "@/components/connect-screen";

export const metadata: Metadata = { title: "Claude" };

export default function ClaudePage() {
  return <ConnectScreen kind="claude" />;
}
