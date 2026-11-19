import { buildSteps, liveIndex, mockIndex } from "@/lib/progress";
import type { AccountView, Box, SessionUser, Subscription } from "@/lib/types";

export function toAccountView(input: {
  mock: boolean;
  domain: string;
  user: SessionUser;
  subscription: Subscription | null;
  box: Box | null;
  now?: number;
  mockMs?: number;
}): AccountView {
  const { mock, domain, user, subscription, box } = input;
  const now = input.now ?? Date.now();
  const visible = box && box.status !== "destroyed" ? box : null;
  const hostname = visible ? `${visible.slug}.${domain}` : null;
  const done = visible?.status === "running";
  let index = 0;
  if (visible) {
    if (mock && visible.status === "provisioning") {
      index = mockIndex(now - new Date(visible.createdAt).getTime(), input.mockMs);
    } else {
      index = liveIndex(visible);
    }
  }
  return {
    mock,
    user: { id: user.id, email: user.email, name: user.name, provider: user.provider },
    subscription: subscription ? { status: subscription.status } : null,
    box: visible
      ? {
          slug: visible.slug,
          status: visible.status,
          hostname: hostname ?? "",
          appPort: visible.appPort,
          error: visible.error,
          clone: visible.githubClone
            ? { url: visible.githubClone.url, path: visible.githubClone.path }
            : null,
        }
      : null,
    steps: buildSteps(done ? STEP_COUNT : index, Boolean(done)),
    previewUrl: done && !mock && hostname ? `https://${hostname}` : null,
  };
}

const STEP_COUNT = 4;
