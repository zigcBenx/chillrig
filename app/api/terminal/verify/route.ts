import { connection } from "next/server";
import { verifyBoxTicket } from "@/lib/provision";

export async function GET(request: Request) {
  await connection();
  const ticket = first(
    request.headers.get("x-chillrig-ticket"),
    request.headers.get("x-chillrig-ticket-header"),
  );
  const host = request.headers.get("x-forwarded-host") ?? "";
  if (!ticket || !host) return new Response(null, { status: 401 });
  try {
    const ok = await verifyBoxTicket(ticket, host);
    return new Response(null, { status: ok ? 200 : 401 });
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 200) : "verify");
    return new Response(null, { status: 401 });
  }
}

function first(...values: Array<string | null>) {
  return values.find((value) => value && value.length > 0) ?? "";
}
