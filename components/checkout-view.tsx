"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Billing = {
  mock: boolean;
  amount: string;
  interval: string;
  note: string;
  subscription: string | null;
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
        <p className="text-sm font-medium">Chill</p>
        <p className="headline mt-4 text-6xl">{billing?.amount ?? "€29"}</p>
        <p className="muted mt-2 text-sm">/ {billing?.interval ?? "month"} · {billing?.note ?? "VAT included"}</p>
        <ul className="muted mx-auto mt-8 grid max-w-xs gap-2 text-sm">
          <li>Always on</li>
          <li>One machine</li>
          <li>Private</li>
        </ul>
        <Button className="mt-8 w-full" disabled={pending || !billing} onClick={() => void pay()}>
          {paid ? "Create box" : "Pay"}
        </Button>
        {error ? <p className="mt-4 text-sm danger">{error}</p> : null}
      </div>
    </main>
  );
}
