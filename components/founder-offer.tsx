"use client";

import { useEffect, useState } from "react";

type Founder = { code: string; left: number } | null;

/** Shows the founder price only while the Stripe promo code is live and has spots left. */
export function FounderOffer({ variant = "line" }: { variant?: "line" | "card" }) {
  const [founder, setFounder] = useState<Founder>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/founder", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { founder: null }))
      .then((data: { founder: Founder }) => {
        if (!cancel) setFounder(data.founder);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  if (!founder) return null;
  if (variant === "card") {
    return (
      <div className="rounded-2xl border border-[var(--chip-border)] bg-[var(--chip-fill)] px-4 py-3 text-left text-sm">
        <p className="font-medium">Founder price: €19 / month, for life</p>
        <p className="muted mt-1">
          First 10 customers. Use code <span className="font-mono font-semibold">{founder.code}</span> at checkout.{" "}
          {founder.left} left.
        </p>
      </div>
    );
  }
  return (
    <p className="text-[15px]" style={{ color: "var(--fg-soft)" }}>
      Founder price for the first 10: <strong>€19 / month for life</strong> with code{" "}
      <span className="font-mono font-semibold">{founder.code}</span> · {founder.left} left
    </p>
  );
}
