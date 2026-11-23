import { json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { requireUser } from "@/lib/session";
import { displayPrice, founderOffer } from "@/lib/stripe-client";
import { store } from "@/lib/store";

export const GET = route(async () => {
  const user = await requireUser();
  const subscription = await store().getSubscription(user.id);
  const amount = isMockMode() ? "€29" : await displayPrice();
  return json({
    mock: isMockMode(),
    amount,
    interval: "month",
    note: "VAT included · cancel anytime",
    founder: isMockMode() ? { code: "FOUNDER10", left: 10 } : await founderOffer(),
    subscription: subscription?.status ?? null,
  });
});
