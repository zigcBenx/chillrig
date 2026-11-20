import { connection } from "next/server";
import { json } from "@/lib/http";
import { completeReadyToken } from "@/lib/provision";

export const maxDuration = 60;

export async function POST(request: Request) {
  await connection();
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return json({ ok: false }, 401);
  try {
    const ok = await completeReadyToken(token);
    return json({ ok }, ok ? 200 : 401);
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 200) : "ready");
    return json({ ok: false }, 500);
  }
}
