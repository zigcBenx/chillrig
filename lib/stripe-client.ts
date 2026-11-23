import "server-only";
import Stripe from "stripe";
import { HttpError } from "@/lib/http";

let client: Stripe | null = null;

export const webCrypto = Stripe.createSubtleCryptoProvider();

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(500, "Stripe is not configured");
  // The fetch client works on Node and on Cloudflare Workers.
  if (!client) {
    client = new Stripe(key, {
      appInfo: { name: "Chillrig", version: "0.1.0" },
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return client;
}

export function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

let priceCache: { at: number; label: string } | null = null;

export async function displayPrice() {
  if (priceCache && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.label;
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new HttpError(500, "Stripe price is not configured");
  const price = await stripe.prices.retrieve(priceId);
  const amount = price.unit_amount ?? 0;
  const currency = price.currency || "eur";
  const label =
    currency === "eur" && amount === 2900
      ? "€29"
      : new Intl.NumberFormat("en-IE", {
          style: "currency",
          currency: currency.toUpperCase(),
          minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        }).format(amount / 100);
  priceCache = { at: Date.now(), label };
  return label;
}

let founderCache: { at: number; value: { code: string; left: number } | null } | null = null;

/** Founder promo code and how many redemptions are left, or null when none apply. */
export async function founderOffer() {
  if (founderCache && Date.now() - founderCache.at < 5 * 60 * 1000) return founderCache.value;
  const code = (process.env.CHILLRIG_FOUNDER_CODE || "FOUNDER10").trim();
  let value: { code: string; left: number } | null = null;
  try {
    const listed = await getStripe().promotionCodes.list({ code, active: true, limit: 1 });
    const promo = listed.data[0];
    if (promo) {
      const max = promo.max_redemptions ?? null;
      const left = max === null ? 10 : Math.max(0, max - promo.times_redeemed);
      value = left > 0 ? { code, left } : null;
    }
  } catch {
    value = null;
  }
  founderCache = { at: Date.now(), value };
  return value;
}
