import { assertSameOrigin, json, route } from "@/lib/http";
import { setBoxPort } from "@/lib/provision";
import { requireUser } from "@/lib/session";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const body = (await request.json().catch(() => null)) as { port?: unknown } | null;
  const port = await setBoxPort(user.id, body?.port);
  return json({ port });
});
