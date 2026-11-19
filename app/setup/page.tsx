import type { Metadata } from "next";
import { SetupView } from "@/components/setup-view";

export const metadata: Metadata = { title: "Setting up" };

export default function SetupPage() {
  return <SetupView />;
}
