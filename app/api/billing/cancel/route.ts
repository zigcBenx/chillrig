import { assertSameOrigin, HttpError, json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { destroyUserBox, markSubscription } from "@/lib/provision";
import { requireUser } from "@/lib/session";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  if (!isMockMode()) throw new HttpError(400, "Cancel in the billing portal");
  const user = await requireUser();
  await markSubscription(user.id, "canceled", null, null);
  await destroyUserBox(user.id);
  return json({ ok: true });
});
