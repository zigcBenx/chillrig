import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { COMPANY, SUPPORT_EMAIL } from "@/lib/links";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Chillrig is run by {COMPANY.name} ({COMPANY.country}). By creating an account or paying you agree to these terms.
      </p>
      <h2>What you get</h2>
      <p>
        A private cloud computer (“box”) with AI coding tools installed, reachable from your browser, for as long as your
        subscription is active. One subscription is for one person and one box. You sign in to your own Claude or ChatGPT
        account on the box; we never see, store or resell those logins, and your AI usage is billed by those providers
        under their terms.
      </p>
      <h2>Price and billing</h2>
      <ul>
        <li>€29 per month, VAT included, billed in advance by Stripe. Founder pricing, where offered, stays as long as the subscription stays active.</li>
        <li>You can cancel anytime from Billing. Your box stays until the end of the paid period, then it and its files are deleted.</li>
        <li>If a payment fails we retry for a short grace period, then the box is deleted.</li>
        <li>Refunds follow our <Link href="/refund">Refund Policy</Link>.</li>
      </ul>
      <h2>Acceptable use</h2>
      <p>You must not use your box to:</p>
      <ul>
        <li>mine cryptocurrency, or run proxies, VPNs or relays for other people;</li>
        <li>send spam, scan or attack other systems, or host malware or phishing;</li>
        <li>host illegal content or infringe others’ rights;</li>
        <li>share one subscription or AI account between several people, or break your AI provider’s terms;</li>
        <li>put unreasonable load on shared infrastructure.</li>
      </ul>
      <p>
        If we see abuse we may suspend or delete the box, with notice where reasonable. Serious abuse is not refunded.
      </p>
      <h2>Your data</h2>
      <p>
        Your code and files are yours. Keep your own backup (for example push to GitHub): a box is a single machine and
        can fail. When your subscription ends the box is deleted and cannot be recovered. See the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <h2>Availability and liability</h2>
      <p>
        We run on third-party providers (Hetzner, Cloudflare, Supabase, Stripe) and do our best to keep your box up, but
        we do not promise uninterrupted service. To the extent the law allows, our liability is limited to what you paid
        us in the last three months. Nothing here limits your rights as a consumer under EU or Slovenian law.
      </p>
      <h2>Changes and law</h2>
      <p>
        We may update these terms and will email you about material changes before they apply. Slovenian law governs
        these terms. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
