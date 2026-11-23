// Custom Worker entry: the OpenNext app for every request, plus a daily cron that runs
// the Hetzner reconciliation (app/api/cron/reconcile) through the same app.
import { default as handler } from "./.open-next/worker.js";

type Env = { SESSION_SECRET?: string; NEXT_PUBLIC_APP_URL?: string; [key: string]: unknown };
type Ctx = { waitUntil(promise: Promise<unknown>): void; passThroughOnException?(): void };

async function cronToken(secret: string) {
  const bytes = new TextEncoder().encode(`chillrig-cron:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  fetch: handler.fetch,
  async scheduled(_event: unknown, env: Env, ctx: Ctx) {
    const secret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET : "";
    if (!secret) {
      console.error("reconcile: SESSION_SECRET missing, skipped");
      return;
    }
    const origin = typeof env.NEXT_PUBLIC_APP_URL === "string" && env.NEXT_PUBLIC_APP_URL ? env.NEXT_PUBLIC_APP_URL : "https://chillrig.invalid";
    const request = new Request(`${origin.replace(/\/$/, "")}/api/cron/reconcile`, {
      method: "POST",
      headers: { "x-chillrig-cron": await cronToken(secret) },
    });
    const response: Response = await handler.fetch(request, env, ctx);
    console.log(`reconcile cron: ${response.status} ${(await response.text()).slice(0, 2000)}`);
  },
};

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
