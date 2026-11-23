"use client";

import { subscriptionAllowsBox } from "@/lib/billing-policy";
import { SUPPORT_EMAIL } from "@/lib/links";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/components/use-account";
import { Check } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function SetupView() {
  const router = useRouter();
  const { data, error } = useAccount(1000);
  const [pending, setPending] = useState(false);

  // Back from Stripe: the webhook can land a few seconds after the redirect. Confirm the
  // session ourselves instead of bouncing a paying customer back to the checkout page.
  const [sessionId] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("session_id"),
  );
  const [confirming, setConfirming] = useState(Boolean(sessionId));
  const [pendingPayment, setPendingPayment] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancel = false;
    let tries = 0;
    const attempt = async () => {
      tries += 1;
      try {
        const response = await fetch("/api/checkout/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean };
        if (cancel) return;
        if (body.ok) {
          setConfirming(false);
          return;
        }
        if (body.pending) setPendingPayment(true);
      } catch {
        // Retry below.
      }
      if (!cancel && tries < 20) window.setTimeout(() => void attempt(), 3000);
      else if (!cancel) setConfirming(false);
    };
    void attempt();
    return () => {
      cancel = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!data) return;
    if (!subscriptionAllowsBox(data.subscription?.status)) {
      if (confirming || pendingPayment) return;
      router.replace("/checkout");
      return;
    }
    if (data.box?.status === "running") {
      const timer = window.setTimeout(() => router.replace("/dashboard"), 700);
      return () => window.clearTimeout(timer);
    }
    if ((!data.box || data.box.status === "destroyed") && !confirming) router.replace("/checkout");
  }, [data, router, confirming, pendingPayment]);

  async function retry() {
    setPending(true);
    await fetch("/api/boxes/retry", { method: "POST" });
    setPending(false);
  }

  const failed = data?.box?.status === "error";
  const waiting = data?.box?.status === "waiting";

  return (
    <main className="grid min-h-dvh place-items-center px-5 pb-12 pt-24">
      <div className="rise glass w-full max-w-md px-8 py-12 text-center">
        <div className="setup-logo-stage mx-auto h-32 w-32" role="img" aria-label={failed ? "Setup stopped" : "Setting up"}>
          <div className={`setup-logo${failed ? " is-failed" : ""}`}>
            <Image src="/logo.webp" alt="" width={88} height={88} unoptimized priority />
          </div>
          <div className="setup-logo-shadow" />
        </div>
        <h1 className="headline mt-8 text-3xl">
          {failed
            ? "Needs attention"
            : pendingPayment
              ? "Waiting for your payment"
              : waiting
                ? "Waiting for capacity"
                : "Setting up your box"}
        </h1>
        {!failed ? (
          <p className="muted mt-3 text-sm">
            {pendingPayment
              ? "Your bank is still confirming the payment. We start building the moment it clears."
              : waiting
                ? "Our cloud provider is out of machines in your price range right now. We retry every minute, and you are not charged extra."
                : "This takes about 3 minutes. You can close this tab; your box keeps building."}
          </p>
        ) : null}
        {failed ? <p className="muted mt-3 text-sm">{data?.box?.error || "Setup stopped"}</p> : null}
        <ul className="mt-8 space-y-3 text-left">
          {data?.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--chip-fill)]">
                {step.state === "done" ? <Check className="h-3.5 w-3.5" /> : <span className={`h-1.5 w-1.5 rounded-full ${step.state === "current" ? "bg-current" : "bg-current/25"}`} />}
              </span>
              <span className={step.state === "todo" ? "muted" : ""}>{step.label}</span>
            </li>
          ))}
        </ul>
        {failed ? (
          <Button className="mt-8" disabled={pending} onClick={() => void retry()}>
            Retry
          </Button>
        ) : null}
        {!failed ? (
          <div className="mt-8 rounded-2xl border border-[var(--chip-border)] bg-[var(--chip-fill)] px-4 py-3 text-left text-sm">
            <p className="font-medium">What happens next</p>
            <p className="muted mt-1">
              When it is ready you will connect your own Claude or ChatGPT account on the box. Have your login handy.
            </p>
          </div>
        ) : (
          <p className="muted mt-4 text-xs">
            Still stuck after a retry? Email{" "}
            <a className="underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{" "}
            and we will fix it by hand or refund you.
          </p>
        )}
        {error ? <p className="muted mt-4 text-sm">{error}</p> : null}
      </div>
    </main>
  );
}
