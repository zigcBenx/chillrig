import { subscriptionAllowsBox } from "@/lib/billing-policy";
import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { ensureBox } from "@/lib/provision";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";

export const maxDuration = 60;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const subscription = await store().getSubscription(user.id);
  if (!subscriptionAllowsBox(subscription?.status)) throw new HttpError(402, "Subscription is not active");
  await ensureBox(user.id, subscription.stripeSubscriptionId);
  return json({ ok: true });
});
