import { createHash } from "node:crypto";
import { emailLoginEnabled } from "@/lib/config";
import { demoProfile } from "@/lib/demo";
import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { setMockSession } from "@/lib/session";
import { store } from "@/lib/store";
import type { Profile, Provider } from "@/lib/types";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  if (!isMockMode()) throw new HttpError(400, "Mock sign-in is disabled");
  const body = (await request.json().catch(() => null)) as { provider?: string; email?: string } | null;
  const provider = body?.provider;
  if (provider !== "google" && provider !== "github" && provider !== "email") {
    throw new HttpError(400, "Pick Google or GitHub");
  }
  if (provider === "email" && !emailLoginEnabled()) throw new HttpError(400, "Email sign-in is disabled");
  const seeded = provider === "email" ? emailProfile(body?.email) : demoProfile(provider as Provider);
  const existing = await store().getProfile(seeded.id);
  const profile = existing ?? seeded;
  if (!existing) await store().upsertProfile(profile);
  await setMockSession(profile);
  return json({ ok: true });
});

function emailProfile(value: string | undefined): Profile {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter an email address");
  const id = `usr_email_${createHash("sha256").update(email).digest("hex").slice(0, 12)}`;
  const name = email.split("@")[0] || "Coder";
  return {
    id,
    email,
    name,
    provider: "email",
    avatarUrl: null,
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
  };
}
