import "server-only";
import { cookies } from "next/headers";
import { sessionSecret } from "@/lib/config";
import { HttpError } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { store } from "@/lib/store";
import { readPayload, signPayload } from "@/lib/tokens";
import type { Profile, SessionUser } from "@/lib/types";
import { createSupabaseServer } from "@/lib/supabase/server";

export const SESSION_COOKIE = "chillrig_session";

type SessionToken = {
  purpose: "session";
  exp: number;
  sub: string;
  email: string;
  name: string;
  provider: string;
};

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function setMockSession(profile: Profile) {
  const token = signPayload(
    {
      purpose: "session",
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      sub: profile.id,
      email: profile.email,
      name: profile.name,
      provider: profile.provider,
    },
    sessionSecret(),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearMockSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  if (isMockMode()) return getMockUser();
  return getLiveUser();
}

async function getMockUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const payload = readPayload<SessionToken>(raw, sessionSecret());
  if (!payload || payload.purpose !== "session") return null;
  const profile = await store().getProfile(payload.sub);
  if (!profile) return null;
  return { id: profile.id, email: profile.email, name: profile.name, provider: profile.provider };
}

async function getLiveUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const existing = await store().getProfile(data.user.id);
  if (existing) {
    return { id: existing.id, email: existing.email, name: existing.name, provider: existing.provider };
  }
  const metadata = data.user.user_metadata ?? {};
  const provider =
    (typeof data.user.app_metadata?.provider === "string" && data.user.app_metadata.provider) || "github";
  const profile: Profile = {
    id: data.user.id,
    email: data.user.email ?? "",
    name:
      (typeof metadata.full_name === "string" && metadata.full_name) ||
      (typeof metadata.name === "string" && metadata.name) ||
      data.user.email ||
      "You",
    provider,
    avatarUrl: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
  };
  await store().upsertProfile(profile);
  return { id: profile.id, email: profile.email, name: profile.name, provider: profile.provider };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Sign in required");
  return user;
}
