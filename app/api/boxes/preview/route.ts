import { connection, NextResponse } from "next/server";
import { validProjectName } from "@/lib/box-client";
import { requestOrigin } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { issueBoxTicket } from "@/lib/provision";
import { getCurrentUser } from "@/lib/session";
import { store } from "@/lib/store";

/**
 * "Open preview": a plain link to here. Checks the session, issues the usual 90-second
 * box ticket and sends the browser to the box, which checks the ticket once (Caddy's
 * forward_auth), sets its own preview cookie and starts the project's dev server.
 * After that the preview never calls this Worker again.
 */
export async function GET(request: Request) {
  await connection();
  const origin = requestOrigin(request);
  const url = new URL(request.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  if (isMockMode()) return NextResponse.redirect(new URL("/preview", origin));
  const box = await store().getBoxByUser(user.id);
  if (!box || box.status !== "running") return NextResponse.redirect(new URL("/dashboard", origin));

  const { ticket, hostname } = issueBoxTicket(user.id, box);
  const target = new URL(`https://${hostname}/_chillrig/preview/enter`);
  target.searchParams.set("ticket", ticket);
  const project = url.searchParams.get("project");
  if (validProjectName(project)) target.searchParams.set("project", project);
  const next = url.searchParams.get("next");
  if (next && /^\/(?![/\\])[^\s\\]{0,499}$/.test(next)) target.searchParams.set("next", next);
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
