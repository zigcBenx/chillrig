import type { Box, StepState } from "@/lib/types";

export const STEP_DEFS = [
  { id: "create", label: "Creating your box" },
  { id: "install", label: "Installing tools" },
  { id: "secure", label: "Securing the connection" },
  { id: "ready", label: "Ready" },
] as const;

export const DEFAULT_MOCK_MS = 7000;

export function mockIndex(elapsed: number, total = DEFAULT_MOCK_MS) {
  if (elapsed >= total * 0.8) return 3;
  if (elapsed >= total * 0.55) return 2;
  if (elapsed >= total * 0.28) return 1;
  return 0;
}

export function mockIsReady(elapsed: number, total = DEFAULT_MOCK_MS) {
  return elapsed >= total;
}

export function liveIndex(box: Pick<Box, "status" | "hetznerServerId" | "dnsRecordId">) {
  if (box.status === "running") return 3;
  if (box.dnsRecordId) return 2;
  if (box.hetznerServerId) return 1;
  return 0;
}

export function buildSteps(index: number, done: boolean): { id: string; label: string; state: StepState }[] {
  return STEP_DEFS.map((step, i) => ({
    id: step.id,
    label: step.label,
    state: done || i < index ? "done" : i === index ? "current" : "todo",
  }));
}
