import { connection } from "next/server";
import { emailCodeEnabled, emailLoginEnabled, oauthEnabled, supabaseAnonKey, supabaseUrl } from "@/lib/config";
import { json } from "@/lib/http";
import { isMockMode } from "@/lib/mode";

let githubCache: { at: number; enabled: boolean } | null = null;

/**
 * Show "Continue with GitHub" only when the Supabase project really has the GitHub
 * provider on. Otherwise the button leads to a raw "provider is not enabled" error page.
 */
async function githubProviderEnabled() {
  if (githubCache && Date.now() - githubCache.at < 5 * 60_000) return githubCache.enabled;
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return false;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(4000),
    });
    const data = (await response.json()) as { external?: { github?: boolean } };
    const enabled = response.ok && data.external?.github === true;
    githubCache = { at: Date.now(), enabled };
    return enabled;
  } catch {
    return false;
  }
}

export async function GET() {
  await connection();
  const mock = isMockMode();
  const wantsOauth = mock || oauthEnabled() || !emailLoginEnabled();
  return json({
    mock,
    emailLogin: emailLoginEnabled(),
    emailCode: emailCodeEnabled(),
    oauth: mock ? true : wantsOauth && (await githubProviderEnabled()),
    supabaseUrl: mock ? null : supabaseUrl() || null,
    supabaseAnonKey: mock ? null : supabaseAnonKey() || null,
  });
}
