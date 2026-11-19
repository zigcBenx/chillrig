"use client";

import { Button } from "@/components/ui/button";
import { safeNext } from "@/lib/safe-next";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

type Config = { mock: boolean; supabaseUrl: string | null; supabaseAnonKey: string | null };

function subscribe() {
  return () => {};
}

export function LoginView() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"google" | "github" | null>(null);
  const urlError = useSyncExternalStore(
    subscribe,
    () => (new URLSearchParams(window.location.search).get("error") ? "Sign-in didn't finish" : null),
    () => null,
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    void fetch("/api/config")
      .then((response) => response.json())
      .then((data: Config) => setConfig(data))
      .catch(() => setError("Sign-in is unavailable"));
    void fetch("/api/session")
      .then((response) => response.json())
      .then((data: { user: unknown }) => {
        if (data.user) router.replace(safeNext(params.get("next")));
      })
      .catch(() => undefined);
  }, [router]);

  async function signIn(provider: "google" | "github") {
    setPending(provider);
    setError(null);
    try {
      if (!config) return;
      if (config.mock) {
        const response = await fetch("/api/auth/mock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        if (!response.ok) throw new Error("Sign-in failed");
        const next = safeNext(new URLSearchParams(window.location.search).get("next"));
        router.push(next);
        router.refresh();
        return;
      }
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        setError("Sign-in is not configured");
        setPending(null);
        return;
      }
      const supabase = createBrowserSupabase(config.supabaseUrl, config.supabaseAnonKey);
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
    } catch {
      setError("Sign-in failed");
      setPending(null);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5 pb-12 pt-24">
      <div className="rise glass w-full max-w-sm px-7 py-10 text-center">
        <h1 className="headline text-3xl">Sign in</h1>
        <div className="mt-8 grid gap-3">
          <Button disabled={!config || pending !== null} onClick={() => void signIn("google")}>
            Google
          </Button>
          <Button variant="ghost" disabled={!config || pending !== null} onClick={() => void signIn("github")}>
            GitHub
          </Button>
        </div>
        {error || urlError ? <p className="mt-4 text-sm text-[#9b3b3b] dark:text-[#ffb4b4]">{error || urlError}</p> : null}
      </div>
    </main>
  );
}
