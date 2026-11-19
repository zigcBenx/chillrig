import { json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { getCurrentUser } from "@/lib/session";

export const GET = route(async () => {
  const user = await getCurrentUser();
  return json({ user, mock: isMockMode() });
});
