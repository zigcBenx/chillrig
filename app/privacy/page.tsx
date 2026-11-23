import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { COMPANY, SUPPORT_EMAIL } from "@/lib/links";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {COMPANY.name} ({COMPANY.country}) is the controller of the personal data described here. We collect as little
        as we can to run Chillrig.
      </p>
      <h2>What we collect and why</h2>
      <ul>
        <li><strong>Account:</strong> your email and login details, to sign you in (contract).</li>
        <li><strong>Billing:</strong> handled by Stripe. We keep your Stripe customer and subscription IDs and status; we never see full card numbers (contract, legal obligation for invoices).</li>
        <li><strong>Your box:</strong> its name, IP address, server type and status, so we can run and clean it up (contract).</li>
        <li><strong>Basic logs:</strong> request logs at our hosting provider for security and debugging, kept briefly (legitimate interest).</li>
      </ul>
      <p>
        We do not read your code, record your terminal, or store your Claude or ChatGPT logins. Those live only on your
        box. We do not sell data or use advertising trackers.
      </p>
      <h2>Who processes it</h2>
      <ul>
        <li>Hetzner Online (Germany/Finland): runs your box.</li>
        <li>Supabase: accounts and database.</li>
        <li>Cloudflare: website hosting.</li>
        <li>Stripe: payments.</li>
      </ul>
      <p>Where a provider transfers data outside the EU it does so under Standard Contractual Clauses or an adequacy decision.</p>
      <h2>How long</h2>
      <p>
        Your box and its files are deleted when your subscription ends. Account data is kept while you have an account
        and deleted on request; invoice records are kept as long as tax law requires (10 years in Slovenia).
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask to access, correct, export or delete your data, or object to processing, by emailing{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We answer within 30 days. You can also complain to the
        Slovenian Information Commissioner (Informacijski pooblaščenec, ip-rs.si).
      </p>
      <h2>Cookies</h2>
      <p>We only use cookies needed to keep you signed in. No consent banner is needed for those.</p>
    </LegalPage>
  );
}
