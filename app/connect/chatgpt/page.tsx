import type { Metadata } from "next";
import { ConnectScreen } from "@/components/connect-screen";

export const metadata: Metadata = { title: "ChatGPT" };

export default function ChatGptPage() {
  return <ConnectScreen kind="chatgpt" />;
}
