import { assertSameOrigin, json, route } from "@/lib/http";
import { isMockMode } from "@/lib/mode";
import { clearMockSession } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  if (!isMockMode()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  await clearMockSession();
  return json({ ok: true });
});
