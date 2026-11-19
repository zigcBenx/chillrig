import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/http";
import { supabaseAnonKey, supabaseUrl } from "@/lib/config";

export async function createSupabaseServer() {
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!url || !anon) throw new HttpError(500, "Supabase is not configured");
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
        }
      },
    },
  });
}
