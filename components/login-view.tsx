"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeNext } from "@/lib/safe-next";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";

type Config = {
  mock: boolean;
  emailLogin: boolean;
  emailCode?: boolean;
  oauth?: boolean;
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
  const [pending, setPending] = useState<"google" | "github" | "email" | "code" | "password" | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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

  // Email + password works without sending any email (Supabase auto-confirms new users),
  // so sign-in never hits the built-in mailer's hourly limit. One button: sign in, or
  // create the account if this email is new.
  async function continueWithPassword(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    if (config.mock) return sendEmail();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      setError("Sign-in is not configured");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters");
      return;
    }
    setPending("password");
    setError(null);
    try {
      const supabase = createBrowserSupabase(config.supabaseUrl, config.supabaseAnonKey);
      const address = email.trim();
      const signedIn = await supabase.auth.signInWithPassword({ email: address, password });
      if (signedIn.error) {
        const created = await supabase.auth.signUp({ email: address, password });
        const taken =
          created.error?.code === "user_already_exists" ||
          (created.data.user && (created.data.user.identities?.length ?? 0) === 0);
        if (taken) throw new Error("Wrong password");
        if (created.error || !created.data.session) throw new Error("Sign-in failed");
      }
      router.push(nextPath());
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "Wrong password"
          ? "Wrong password. Forgot it? Use “Email me a sign-in link” below."
          : "Sign-in failed. Try again in a moment.",
      );
      setPending(null);
    }
  }

  async function sendEmail(event?: FormEvent) {
    event?.preventDefault();
    if (!config) return;
    if (!email.trim()) {
      setError("Enter your email");
      return;
    }
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
      setError("Email is busy right now. Use a password instead.");
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
        <p className="muted mt-2 text-sm">New here? Enter any email and a password. Your account is created on the spot.</p>
        <div className="mt-8 grid gap-3">
          {config?.oauth ? (
            <Button disabled={pending !== null} onClick={() => void signIn("github")}>
              Continue with GitHub
            </Button>
          ) : null}
          {config?.emailLogin ? (
            <form className={`${config.oauth ? "mt-2 " : ""}grid gap-3 text-left`} onSubmit={(event) => void continueWithPassword(event)}>
              <Input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Password (8+ characters)"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button type="submit" disabled={pending !== null}>
                Continue
              </Button>
              <Button type="button" variant="ghost" disabled={pending !== null} onClick={() => void sendEmail()}>
                Email me a sign-in link
              </Button>
              {sent ? (
                <p className="muted text-center text-sm">
                  {config.emailCode && !config.mock ? "Check your inbox for the link, or enter the code." : "Check your inbox for the link."}
                </p>
              ) : null}
            </form>
          ) : null}
          {config?.emailLogin && config.emailCode && sent && !config.mock ? (
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
        {error || urlError ? <p className="mt-4 text-sm danger">{error || urlError}</p> : null}
        <p className="muted mt-6 text-xs">
          By continuing you agree to the{" "}
          <Link className="underline underline-offset-2" href="/terms">
            Terms
          </Link>{" "}
          and{" "}
          <Link className="underline underline-offset-2" href="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
