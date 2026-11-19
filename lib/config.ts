import "server-only";
import { HttpError } from "@/lib/http";

export function domainName() {
  return (process.env.CHILLRIG_DOMAIN || "chillrig.test").trim().toLowerCase().replace(/\.$/, "");
}

export function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.CHILLRIG_CONTROL_PLANE || "").replace(/\/$/, "");
}

export function controlPlaneUrl() {
  return (process.env.CHILLRIG_CONTROL_PLANE || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}

export function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

export function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function serviceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new HttpError(500, "Supabase is not configured");
  return key;
}

export function sessionSecret() {
  const secret = process.env.SESSION_SECRET || "";
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "dev-only-session-secret";
  throw new HttpError(500, "SESSION_SECRET is not configured");
}

export function ticketSecret() {
  return process.env.TERMINAL_TOKEN_SECRET || sessionSecret();
}

export function requireLiveValue(name: string, value: string | undefined) {
  if (!value) throw new HttpError(500, `${name} is not configured`);
  return value;
}
