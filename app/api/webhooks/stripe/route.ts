import type Stripe from "stripe";
import { subscriptionEndsBox } from "@/lib/billing-policy";
import { sendPaymentFailedEmail } from "@/lib/email";
import { json } from "@/lib/http";
import { destroyUserBox, markSubscription, activateAndProvision } from "@/lib/provision";
import { getStripe, stripeId, webCrypto } from "@/lib/stripe-client";
import { store } from "@/lib/store";
import type { SubscriptionStatus } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret) return json({ error: "Webhook is not configured" }, 500);
  if (!signature) return json({ error: "Missing signature" }, 400);
  // Raw body, verified with Web Crypto so it also runs on Cloudflare Workers.
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(body, signature, secret, undefined, webCrypto);
  } catch {
    return json({ error: "Invalid signature" }, 400);
  }
  const claimed = await store().claimEvent(event.id);
  if (!claimed) return json({ received: true });
  try {
    await handleEvent(event);
    return json({ received: true });
  } catch (error) {
    await store().releaseEvent(event.id);
    console.error(error instanceof Error ? error.message.slice(0, 300) : "webhook");
    return json({ error: "Webhook failed" }, 500);
  }
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id || session.client_reference_id;
      if (!userId || session.mode !== "subscription" || session.status !== "complete") return;
      await activateAndProvision(userId, {
        customerId: stripeId(session.customer),
        subscriptionId: stripeId(session.subscription),
      });
      return;
    }
    case "customer.subscription.deleted":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id || (await store().getSubscriptionByStripeId(subscription.id))?.userId;
      if (!userId) return;
      const status = mapStatus(subscription.status);
      await markSubscription(userId, status, subscription.id, stripeId(subscription.customer));
      if (subscriptionEndsBox(subscription.status)) await destroyUserBox(userId);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) return;
      const row = await store().getSubscriptionByStripeId(subscriptionId);
      if (!row) return;
      await markSubscription(row.userId, "past_due", subscriptionId, row.stripeCustomerId);
      const profile = await store().getProfile(row.userId);
      if (profile) {
        try {
          await sendPaymentFailedEmail(profile);
        } catch {
          // The box stays up even if the warning email fails.
        }
      }
      return;
    }
    default:
      return;
  }
}

function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") return "canceled";
  return "incomplete";
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const legacy = invoice as Stripe.Invoice & { subscription?: string | { id: string } | null };
  if (typeof legacy.subscription === "string") return legacy.subscription;
  if (legacy.subscription && typeof legacy.subscription === "object") return legacy.subscription.id;
  const parent = invoice as Stripe.Invoice & {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const nested = parent.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object") return nested.id;
  return null;
}
