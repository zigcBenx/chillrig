import "server-only";
import { appBaseUrl } from "@/lib/config";
import type { Profile } from "@/lib/types";

export async function sendReadyEmail(profile: Profile, hostname: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !profile.email) return false;
  const dashboard = appBaseUrl() ? `${appBaseUrl()}/dashboard` : "";
  const text = dashboard
    ? `Your Chillrig box is ready.\n\n${hostname}\n${dashboard}\n`
    : `Your Chillrig box is ready.\n\n${hostname}\n`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [profile.email],
      subject: "Your box is ready",
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}
