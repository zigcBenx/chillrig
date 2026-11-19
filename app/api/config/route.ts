import { connection } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/config";
import { json } from "@/lib/http";
import { isMockMode } from "@/lib/mode";

export async function GET() {
  await connection();
  const mock = isMockMode();
  return json({
    mock,
    supabaseUrl: mock ? null : supabaseUrl() || null,
    supabaseAnonKey: mock ? null : supabaseAnonKey() || null,
  });
}
