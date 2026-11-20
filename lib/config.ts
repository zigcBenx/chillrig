import "server-only";
import { HttpError } from "@/lib/http";

export function domainName() {
  return (process.env.CHILLRIG_DOMAIN || "chillrig.test").trim().toLowerCase().replace(/\.$/, "");
}

export function appBaseUrl() {
  return publicAppUrl();
}

export function controlPlaneUrl() {
  return publicAppUrl();
}

export function emailLoginEnabled() {
  const flag = process.env.CHILLRIG_EMAIL_LOGIN?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** Show Google and GitHub buttons. Off until those Supabase providers are set up. */
export function oauthEnabled() {
  const flag = process.env.CHILLRIG_OAUTH?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * Show the "enter the code" box after an email link is sent. Off by default: Supabase's
 * built-in mailer only sends a link, and free projects cannot add {{ .Token }} to the
 * template. Turn on once a custom SMTP provider and a template with the code exist.
 */
export function emailCodeEnabled() {
  const flag = process.env.CHILLRIG_EMAIL_CODE?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function publicAppUrl() {
  const explicit = (process.env.CHILLRIG_CONTROL_PLANE || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/^https?:\/\//, "");
  if (prod) return `https://${prod}`;
  const vercel = process.env.VERCEL_URL?.replace(/^https?:\/\//, "");
  if (vercel) return `https://${vercel}`;
  return "";
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
