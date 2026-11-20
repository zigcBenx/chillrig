"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeNext } from "@/lib/safe-next";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";

type Config = {
  mock: boolean;
  emailLogin: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
};

function subscribe() {
  return () => {};
}

export function LoginView() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"google" | "github" | "email" | "code" | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
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

  function nextPath() {
    return safeNext(new URLSearchParams(window.location.search).get("next"));
  }

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
        router.push(nextPath());
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

  async function sendEmail(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setPending("email");
    setError(null);
    try {
      if (config.mock) {
        const response = await fetch("/api/auth/mock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "email", email }),
        });
        if (!response.ok) throw new Error("Sign-in failed");
        router.push(nextPath());
        router.refresh();
        return;
      }
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        setError("Sign-in is not configured");
        setPending(null);
        return;
      }
      const supabase = createBrowserSupabase(config.supabaseUrl, config.supabaseAnonKey);
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
      setSent(true);
      setPending(null);
    } catch {
      setError("Could not send the sign-in email");
      setPending(null);
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (!config?.supabaseUrl || !config.supabaseAnonKey) return;
    setPending("code");
    setError(null);
    try {
      const supabase = createBrowserSupabase(config.supabaseUrl, config.supabaseAnonKey);
      const { error: authError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (authError) throw authError;
      router.push(nextPath());
      router.refresh();
    } catch {
      setError("That code didn't work");
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
          {config?.emailLogin ? (
            <form className="mt-2 grid gap-3 text-left" onSubmit={(event) => void sendEmail(event)}>
              <Input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button type="submit" variant="ghost" disabled={pending !== null}>
                Email link
              </Button>
              {sent ? <p className="muted text-center text-sm">Check your inbox for the link, or enter the code.</p> : null}
            </form>
          ) : null}
          {config?.emailLogin && sent && !config.mock ? (
            <form className="grid gap-3" onSubmit={(event) => void confirmCode(event)}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                name="code"
                required
                placeholder="6-digit code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" disabled={pending !== null}>
                Use code
              </Button>
            </form>
          ) : null}
        </div>
        {error || urlError ? <p className="mt-4 text-sm text-[#9b3b3b] dark:text-[#ffb4b4]">{error || urlError}</p> : null}
      </div>
    </main>
  );
}
