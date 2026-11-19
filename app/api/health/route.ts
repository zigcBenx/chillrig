import { connection } from "next/server";
import { json } from "@/lib/http";
import { isMockMode } from "@/lib/mode";

export async function GET() {
  await connection();
  return json({ ok: true, mock: isMockMode() });
}
