"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AccountView } from "@/lib/types";

export function useAccount(pollMs: number) {
  const router = useRouter();
  const [data, setData] = useState<AccountView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        if (cancel) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const body = (await response.json()) as AccountView & { error?: string };
        if (!response.ok) {
          setError(body.error ?? "Could not load");
          return;
        }
        setError(null);
        setData(body);
      } catch {
        if (!cancel) setError("Could not load");
      }
    }
    void load();
    const id = window.setInterval(() => void load(), pollMs);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, [pollMs, router]);

  return { data, error };
}
