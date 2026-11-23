import { connection } from "next/server";
import { verifyBoxTicket } from "@/lib/provision";

export async function GET(request: Request) {
  await connection();
  const ticket = first(
    request.headers.get("x-chillrig-ticket"),
    request.headers.get("x-chillrig-ticket-header"),
  );
  // The box's Caddy sends its own hostname. X-Chillrig-Host is the reliable one: on
  // Cloudflare Workers the OpenNext adapter folds X-Forwarded-Host into Host, so check
  // every place the name can land.
  const hosts = [
    request.headers.get("x-chillrig-host"),
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
  ].filter((value): value is string => Boolean(value));
  if (!ticket || hosts.length === 0) return new Response(null, { status: 401 });
  try {
    const sourceIp = request.headers.get("cf-connecting-ip");
    const ok = await verifyBoxTicket(ticket, hosts, sourceIp);
    if (!ok) console.warn("terminal verify rejected", { hosts: hosts.map((h) => h.slice(0, 80)), sourceIp });
    return new Response(null, { status: ok ? 200 : 401 });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 200) : "verify");
    return new Response(null, { status: 401 });
  }
}

function first(...values: Array<string | null>) {
  return values.find((value) => value && value.length > 0) ?? "";
}
