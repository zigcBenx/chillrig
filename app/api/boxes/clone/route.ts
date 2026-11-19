import { assertSameOrigin, json, route } from "@/lib/http";
import { cloneOnBox } from "@/lib/provision";
import { requireUser } from "@/lib/session";

export const maxDuration = 60;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const clone = await cloneOnBox(user.id, body?.url ?? "");
  return json({ clone });
});
