import { assertSameOrigin, HttpError, json, requestOrigin, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { requireUser } from "@/lib/session";
import { getStripe } from "@/lib/stripe-client";
import { store } from "@/lib/store";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  if (isMockMode()) throw new HttpError(400, "Use cancel in demo mode");
  const user = await requireUser();
  const profile = await store().getProfile(user.id);
  if (!profile?.stripeCustomerId) throw new HttpError(400, "No billing account yet");
  const portal = await getStripe().billingPortal.sessions.create({
    customer: profile.stripeCustomerId,
    return_url: `${requestOrigin(request)}/dashboard`,
  });
  return json({ url: portal.url });
});
