import { HttpError, json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { issueBoxTicket } from "@/lib/provision";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";

export const GET = route(async () => {
  const user = await requireUser();
  const box = await store().getBoxByUser(user.id);
  if (!box || box.status === "destroyed") throw new HttpError(404, "No box");
  const issued = issueBoxTicket(user.id, box);
  return json({ ...issued, demo: isMockMode() });
});
