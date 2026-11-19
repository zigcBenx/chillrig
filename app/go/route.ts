import { connection, NextResponse } from "next/server";
import { loadAccount } from "@/lib/provision";
import { getCurrentUser } from "@/lib/session";

export async function GET(request: Request) {
  await connection();
  const user = await getCurrentUser();
  const origin = new URL(request.url).origin;
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const { subscription, box } = await loadAccount(user.id);
  if (!subscription || subscription.status !== "active") {
    return NextResponse.redirect(new URL("/checkout", origin));
  }
  if (!box || box.status === "destroyed") return NextResponse.redirect(new URL("/checkout", origin));
  if (box.status === "running") return NextResponse.redirect(new URL("/dashboard", origin));
  return NextResponse.redirect(new URL("/setup", origin));
}
