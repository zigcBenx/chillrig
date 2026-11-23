"use client";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { GITHUB_URL } from "@/lib/links";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/types";

type SessionState = { user: SessionUser | null; mock: boolean };

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const landing = usePathname() === "/";
  const [session, setSession] = useState<SessionState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: SessionState) => {
        if (!cancel) setSession(data);
      })
      .catch(() => {
        if (!cancel) setSession({ user: null, mock: false });
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const initial = session?.user?.name?.slice(0, 1).toUpperCase() ?? "";

  return (
    <div className="relative min-h-dvh">
      <div className="ambient" aria-hidden />
      <header className="fixed top-3 left-1/2 z-20 w-[min(1072px,calc(100%-1.5rem))] -translate-x-1/2 sm:top-4">
        <nav className="glass glass-nav glass-blur flex items-center justify-between gap-3 py-2 pr-2 pl-[18px]" aria-label="Main">
          <Logo />
          {landing ? (
            <div className="hidden items-center gap-1 md:flex">
              <a className="nav-link" href="#how">
                How it works
              </a>
              <a className="nav-link" href="#pricing">
                Pricing
              </a>
              <a className="nav-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            {session?.mock ? <span className="demo-pill">Demo</span> : null}
            <ThemeToggle />
            {session?.user ? (
              <div className="relative">
                <button
                  type="button"
                  className="icon-btn text-sm font-semibold"
                  aria-label="Account"
                  onClick={() => setOpen((value) => !value)}
                >
                  {initial}
                </button>
                {open ? (
                  <div className="glass glass-blur absolute right-0 mt-2 w-52 rounded-2xl p-3 text-left">
                    <p className="truncate text-sm font-medium">{session.user.name}</p>
                    <p className="muted truncate text-xs">{session.user.email}</p>
                    <button type="button" className="btn-quiet mt-3 text-sm" onClick={() => void signOut()}>
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {landing ? (
              <Link href="/go" className="btn btn-sm ml-1">
                {session?.user ? "Open your box" : "Get your box"}
              </Link>
            ) : null}
          </div>
        </nav>
      </header>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
