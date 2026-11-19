import { assertSameOrigin, HttpError, json, requestOrigin, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { activateAndProvision, ensureBox } from "@/lib/provision";
import { requireUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe-client";
import { store } from "@/lib/store";

export const maxDuration = 60;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const origin = requestOrigin(request);
  const subscription = await store().getSubscription(user.id);
  if (subscription?.status === "active") {
    await ensureBox(user.id, subscription.stripeSubscriptionId);
    return json({ url: `${origin}/setup` });
  }
  if (isMockMode()) {
    await activateAndProvision(user.id, {
      customerId: `cus_demo_${user.id}`,
      subscriptionId: `sub_demo_${user.id}`,
    });
    return json({ url: `${origin}/setup` });
  }
  const profile = await store().getProfile(user.id);
  if (!profile) throw new HttpError(401, "Sign in required");
  const stripe = getStripe();
  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email || undefined,
      name: profile.name,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await store().setStripeCustomer(user.id, customerId);
  }
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) throw new HttpError(500, "Stripe price is not configured");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/setup?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout`,
    metadata: { user_id: user.id },
    subscription_data: { metadata: { user_id: user.id } },
  });
  if (!session.url) throw new HttpError(502, "Stripe did not return a checkout URL");
  return json({ url: session.url });
});
