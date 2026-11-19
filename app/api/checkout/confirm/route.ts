import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { activateAndProvision } from "@/lib/provision";
import { requireUser } from "@/lib/session";
import { getStripe, stripeId } from "@/lib/stripe-client";

export const maxDuration = 60;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser();
  if (isMockMode()) return json({ ok: true });
  const body = (await request.json().catch(() => null)) as { sessionId?: string } | null;
  const sessionId = body?.sessionId;
  if (!sessionId || !sessionId.startsWith("cs_")) throw new HttpError(400, "Invalid session");
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const owner = session.metadata?.user_id || session.client_reference_id;
  if (owner !== user.id) throw new HttpError(403, "Forbidden");
  if (session.status !== "complete") return json({ ok: false });
  await activateAndProvision(user.id, {
    customerId: stripeId(session.customer),
    subscriptionId: stripeId(session.subscription),
  });
  return json({ ok: true });
});
