import { connection } from "next/server";
import { json } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { founderOffer } from "@/lib/stripe-client";

/** Public: is the founder code live, and how many spots are left. Cached 5 minutes. */
export async function GET() {
  await connection();
  const founder = isMockMode() ? { code: "FOUNDER10", left: 10 } : await founderOffer();
  return json({ founder });
}
