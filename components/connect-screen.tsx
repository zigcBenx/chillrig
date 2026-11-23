"use client";

import { OnboardingWizard } from "@/components/onboarding-wizard";

/** /connect/claude and /connect/chatgpt: the onboarding wizard with that tool picked. */
export function ConnectScreen({ kind }: { kind: "claude" | "chatgpt" }) {
  return <OnboardingWizard initialTool={kind === "chatgpt" ? "codex" : "claude"} />;
}
