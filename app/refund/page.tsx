import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { SUPPORT_EMAIL } from "@/lib/links";

export const metadata: Metadata = { title: "Refunds" };

export default function Refund() {
  return (
    <LegalPage title="Refund Policy">
      <h2>7-day money-back</h2>
      <p>
        If Chillrig is not for you, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> within 7 days of your
        first payment and we refund it in full, no questions asked. Your box is deleted when we refund.
      </p>
      <h2>After that</h2>
      <p>
        You can cancel anytime from Billing. You keep your box until the end of the period you paid for, and you are not
        charged again. Partial months are not refunded.
      </p>
      <h2>If something breaks</h2>
      <p>
        If your box could not be set up, or was down for a long time because of us, we refund or credit you. Just email us.
      </p>
      <h2>EU right of withdrawal</h2>
      <p>
        EU consumers normally have 14 days to withdraw from an online purchase. Because your box starts right away, at
        checkout you ask us to start the service immediately and accept that the withdrawal right ends once it is fully
        delivered; if you withdraw within 14 days we refund the payment minus the days already used. Our 7-day full
        refund above comes on top of this.
      </p>
      <p>Refunds go back to the original payment method, usually within 5–10 days.</p>
    </LegalPage>
  );
}
