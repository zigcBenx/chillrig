import type { EmailOtpType } from "@supabase/supabase-js";
import { connection, NextResponse } from "next/server";
import { requestOrigin } from "@/lib/http";
import { createSupabaseServer } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await createSupabaseServer();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=1", origin));
    return NextResponse.redirect(new URL("/go", origin));
  }
  if (tokenHash && type && OTP_TYPES.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    if (error) return NextResponse.redirect(new URL("/login?error=1", origin));
    return NextResponse.redirect(new URL("/go", origin));
  }
  return NextResponse.redirect(new URL("/login?error=1", origin));
}
