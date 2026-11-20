"use client";

import { subscriptionAllowsBox } from "@/lib/billing-policy";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/components/use-account";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function SetupView() {
  const router = useRouter();
  const { data, error } = useAccount(1000);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (!subscriptionAllowsBox(data.subscription?.status)) {
      router.replace("/checkout");
      return;
    }
    if (data.box?.status === "running") {
      const timer = window.setTimeout(() => router.replace("/dashboard"), 700);
      return () => window.clearTimeout(timer);
    }
    if (!data.box || data.box.status === "destroyed") router.replace("/checkout");
  }, [data, router]);

  async function retry() {
    setPending(true);
    await fetch("/api/boxes/retry", { method: "POST" });
    setPending(false);
  }

  const failed = data?.box?.status === "error";

  return (
    <main className="grid min-h-dvh place-items-center px-5 pb-12 pt-24">
      <div className="rise glass w-full max-w-md px-8 py-12 text-center">
        <div className="relative mx-auto h-28 w-28">
          <div className="absolute inset-0 rounded-full border border-white/50 dark:border-white/15" />
          {!failed ? (
            <div className="orbit">
              <i />
            </div>
          ) : null}
          <div className="glass absolute inset-4 grid place-items-center rounded-full">
            <span className={`h-3 w-3 rounded-full ${failed ? "bg-[#d06a6a]" : "bg-emerald-400 shadow-[0_0_16px_#34d399]"}`} />
          </div>
        </div>
        <h1 className="headline mt-8 text-3xl">{failed ? "Needs attention" : "Setting up your box"}</h1>
        {failed ? <p className="muted mt-3 text-sm">{data?.box?.error || "Setup stopped"}</p> : null}
        <ul className="mt-8 space-y-3 text-left">
          {data?.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-black/5 dark:bg-white/10">
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
        {error ? <p className="muted mt-4 text-sm">{error}</p> : null}
      </div>
    </main>
  );
}
