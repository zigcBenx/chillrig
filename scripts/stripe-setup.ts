import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
const webhookUrl = `${appUrl}/api/webhooks/stripe`;
const events = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!key.startsWith("sk_test_")) fail("STRIPE_SECRET_KEY must be a test key (sk_test_...)");
if (!appUrl.startsWith("https://")) fail("APP_URL must be an https origin");

const stripe = new Stripe(key, { appInfo: { name: "Chillrig", version: "0.1.0" } });

const portalFeatures: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: "immediately", proration_behavior: "none" },
};

async function product() {
  const listed = await stripe.products.list({ active: true, limit: 100 });
  const existing = listed.data.find((item) => item.metadata.chillrig === "1" || item.name === "Chillrig");
  if (existing) return existing;
  return stripe.products.create({
    name: "Chillrig",
    description: "An always-on cloud computer",
    metadata: { chillrig: "1" },
  });
}

async function price(productId: string) {
  const listed = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const existing = listed.data.find(
    (item) =>
      item.unit_amount === 2900 &&
      item.currency === "eur" &&
      item.tax_behavior === "inclusive" &&
      item.recurring?.interval === "month",
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: productId,
    currency: "eur",
    unit_amount: 2900,
    tax_behavior: "inclusive",
    recurring: { interval: "month" },
    nickname: "Chillrig €29 / month",
  });
}

async function webhook() {
  const listed = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const endpoint of listed.data) {
    if (endpoint.url === webhookUrl) await stripe.webhookEndpoints.del(endpoint.id);
  }
  const created = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: [...events],
    description: "Chillrig",
    metadata: { chillrig: "1" },
  });
  if (!created.secret) fail("Stripe did not return a webhook signing secret");
  return created.secret;
}

async function portal() {
  const defaults = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const current = defaults.data[0];
  if (current) {
    const updated = await stripe.billingPortal.configurations.update(current.id, {
      default_return_url: `${appUrl}/dashboard`,
      features: portalFeatures,
    });
    return updated.id;
  }
  const created = await stripe.billingPortal.configurations.create({
    default_return_url: `${appUrl}/dashboard`,
    features: portalFeatures,
    business_profile: { headline: "Manage your Chillrig subscription" },
    metadata: { chillrig: "1" },
  });
  return created.id;
}

async function main() {
  const made = await product();
  const monthly = await price(made.id);
  const secret = await webhook();
  const configuration = await portal();

  console.log(`STRIPE_PRICE_ID=${monthly.id}`);
  console.log(`STRIPE_WEBHOOK_SECRET=${secret}`);
  console.log(`STRIPE_PORTAL_CONFIGURATION=${configuration}`);
}

// No top-level await: tsx runs this file as CommonJS.
main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
