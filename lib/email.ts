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

export async function sendPaymentFailedEmail(profile: Profile) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !profile.email) return false;
  const dashboard = appBaseUrl() ? `${appBaseUrl()}/dashboard` : "";
  const text = dashboard
    ? `A payment for your Chillrig box failed. The box stays on while Stripe retries.\n\nIf the subscription is canceled, the box is deleted.\n${dashboard}\n`
    : "A payment for your Chillrig box failed. The box stays on while Stripe retries.\n\nIf the subscription is canceled, the box is deleted.\n";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [profile.email],
      subject: "Payment failed",
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

/** Operator alert (reconciliation findings). Optional: needs Resend and CHILLRIG_ALERT_EMAIL. */
export async function sendAlertEmail(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = process.env.CHILLRIG_ALERT_EMAIL;
  if (!key || !from || !to) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}
