"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Billing = {
  mock: boolean;
  amount: string;
  interval: string;
  note: string;
  subscription: string | null;
  founder?: { code: string; left: number } | null;
};

export function CheckoutView() {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/billing", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login?next=/checkout");
          return null;
        }
        return response.json() as Promise<Billing & { error?: string }>;
      })
      .then((data) => {
        if (!data) return;
        if ("error" in data && data.error && !data.amount) setError(data.error);
        else setBilling(data);
      })
      .catch(() => setError("Billing is unavailable"));
  }, [router]);

  async function pay() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Payment failed");
      if (data.url.startsWith("/")) {
        router.push(data.url);
        return;
      }
      window.location.assign(data.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment failed");
      setPending(false);
    }
  }

  const paid = billing?.subscription === "active";

  return (
    <main className="grid min-h-dvh place-items-center px-5 pb-12 pt-24">
      <div className="rise glass w-full max-w-md px-7 py-10 text-center sm:px-10">
        <p className="text-sm font-medium">Chillrig</p>
        <p className="headline mt-4 text-6xl">{billing?.amount ?? "€29"}</p>
        <p className="muted mt-2 text-sm">/ {billing?.interval ?? "month"} · {billing?.note ?? "VAT included · cancel anytime"}</p>
        {billing?.founder ? (
          <div className="mt-6 rounded-2xl border border-[var(--chip-border)] bg-[var(--chip-fill)] px-4 py-3 text-sm">
            <p className="font-medium">Founder price: €19 / month, for life</p>
            <p className="muted mt-1">
              Enter <span className="font-mono font-semibold">{billing.founder.code}</span> on the next page.{" "}
              {billing.founder.left} of 10 spots left.
            </p>
          </div>
        ) : null}
        <ul className="mx-auto mt-7 grid max-w-xs gap-2 text-left text-sm" style={{ color: "var(--fg-soft)" }}>
          <li>✓ Your own cloud computer, not shared</li>
          <li>✓ Claude Code and Codex already installed</li>
          <li>✓ Keeps running when your laptop is closed</li>
          <li>✓ Open it from any browser, even your phone</li>
          <li>✓ Ready about 3 minutes after you pay</li>
        </ul>
        <p className="muted mx-auto mt-5 max-w-xs text-xs">
          You sign in to your own Claude or ChatGPT plan on the box. Cancel anytime, full refund within 7 days.
        </p>
        <Button className="mt-7 w-full" disabled={pending || !billing} onClick={() => void pay()}>
          {paid ? "Create my box" : pending ? "Opening secure checkout…" : "Continue to payment"}
        </Button>
        <p className="muted mt-4 text-xs">
          Secure payment by Stripe. By paying you agree to the{" "}
          <Link className="underline underline-offset-2" href="/terms">
            Terms
          </Link>
          ,{" "}
          <Link className="underline underline-offset-2" href="/privacy">
            Privacy
          </Link>{" "}
          and{" "}
          <Link className="underline underline-offset-2" href="/refund">
            Refund
          </Link>{" "}
          policies.
        </p>
        {error ? <p className="mt-4 text-sm danger">{error}</p> : null}
      </div>
    </main>
  );
}
