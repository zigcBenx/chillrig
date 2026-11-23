import { json, route } from "@/lib/http";
import { probeBoxAgent } from "@/lib/provision";
import { requireUser } from "@/lib/session";

export const GET = route(async () => {
  const user = await requireUser();
  return json(await probeBoxAgent(user.id));
});
