import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { json } from "@/lib/http";
import { cronToken, reconcileHetzner } from "@/lib/reconcile";

export const maxDuration = 60;

/** Called once a day by the Worker's cron trigger (worker.ts). Not public. */
export async function POST(request: Request) {
  await connection();
  const expected = cronToken();
  const given = request.headers.get("x-chillrig-cron") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return json({ error: "Not found" }, 404);
  }
  const result = await reconcileHetzner();
  return json({
    apply: result.apply,
    findings: result.findings.filter((item) => item.action !== "skip" || item.reason.startsWith("lookup")),
  });
}
