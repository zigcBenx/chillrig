import { demoProfile } from "@/lib/demo";
import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { setMockSession } from "@/lib/session";
import { store } from "@/lib/store";
import type { Provider } from "@/lib/types";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  if (!isMockMode()) throw new HttpError(400, "Mock sign-in is disabled");
  const body = (await request.json().catch(() => null)) as { provider?: string } | null;
  const provider = body?.provider;
  if (provider !== "google" && provider !== "github") {
    throw new HttpError(400, "Pick Google or GitHub");
  }
  const seeded = demoProfile(provider as Provider);
  const existing = await store().getProfile(seeded.id);
  const profile = existing ?? seeded;
  if (!existing) await store().upsertProfile(profile);
  await setMockSession(profile);
  return json({ ok: true });
});
