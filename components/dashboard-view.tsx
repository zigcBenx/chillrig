"use client";

import { subscriptionAllowsBox } from "@/lib/billing-policy";
import { OrbitIcon, SparkIcon } from "@/components/icons";
import { SessionsCard } from "@/components/sessions-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAccount } from "@/components/use-account";
import { connectBox, previewHref, type BoxClient, type BoxStatus } from "@/lib/box-client";
import { AppWindow, Check, Copy, GitBranch, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// Sign-in status is looked at again when the tab comes back, at most this often.
const STATUS_REFRESH_MS = 15_000;

export function DashboardView() {
  const router = useRouter();
  const { data, error } = useAccount(4000);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [client, setClient] = useState<BoxClient | null>(null);
  const [boxStatus, setBoxStatus] = useState<BoxStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const running = data?.box?.status === "running";
  const signedIn = boxStatus ? boxStatus.claude.loggedIn || boxStatus.codex.loggedIn : null;

  // One look at the box (not a poll): is Claude or ChatGPT signed in, which agent runs?
  // Looked at again when the tab comes back, so signing in elsewhere shows up here.
  useEffect(() => {
    if (!running) return;
    let cancel = false;
    let current: BoxClient | null = null;
    let lastLook = 0;
    const look = async () => {
      lastLook = Date.now();
      try {
        current ??= await connectBox();
        const status = await current.status();
        if (cancel) return;
        setClient(current);
        setBoxStatus(status);
        setStatusFailed(false);
      } catch {
        if (!cancel) setStatusFailed(true);
      }
    };
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastLook > STATUS_REFRESH_MS) void look();
    };
    void look();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancel = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [running]);

  useEffect(() => {
    if (!data) return;
    if (!subscriptionAllowsBox(data.subscription?.status)) {
      router.replace("/checkout");
      return;
    }
    if (!data.box || data.box.status === "destroyed") {
      router.replace("/checkout");
      return;
    }
    if (data.box.status === "provisioning" || data.box.status === "waiting" || data.box.status === "destroying") {
      router.replace("/setup");
    }
  }, [data, router]);

  async function copyHost() {
    if (!data?.box) return;
    await navigator.clipboard.writeText(data.box.hostname);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function cancel() {
    if (!data?.mock) {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await response.json()) as { url?: string; error?: string };
      if (body.url) window.location.assign(body.url);
      else setMessage(body.error ?? "Billing portal is unavailable");
      return;
    }
    setCancelOpen(true);
  }

  async function confirmCancel() {
    setPending(true);
    await fetch("/api/billing/cancel", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  if (!data?.box || data.box.status === "provisioning" || data.box.status === "waiting") {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-5xl place-items-center px-4 pt-24">
        <div className="glass h-40 w-full max-w-xl animate-pulse" />
      </main>
    );
  }

  const box = data.box;
  // Only what the box says. Until it answers, the hint stays empty instead of guessing.
  const signInHint = (loggedIn: boolean | undefined): ReactNode =>
    loggedIn ? (
      <span className="inline-flex items-center gap-1">
        <Check className="h-3.5 w-3.5 text-[var(--signal)]" aria-hidden /> Connected
      </span>
    ) : loggedIn === false || statusFailed || !running ? (
      "Connect"
    ) : (
      "\u00a0"
    );
  const actions: Array<{ href: string; label: string; hint: ReactNode; icon: ReactNode }> = [
    { href: "/connect/claude", label: "Claude", hint: signInHint(boxStatus?.claude.loggedIn), icon: <SparkIcon /> },
    { href: "/connect/chatgpt", label: "ChatGPT", hint: signInHint(boxStatus?.codex.loggedIn), icon: <OrbitIcon /> },
    { href: "/terminal", label: "Terminal", hint: "Open", icon: <Terminal className="h-6 w-6" /> },
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-24 sm:px-6">
      <section className="glass glass-live p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${running ? "pulse bg-[var(--signal)] shadow-[0_0_10px_var(--signal)]" : "bg-[#d6a15a]"}`} />
          <span>{running ? "Running" : box.status === "error" ? "Needs attention" : "Working"}</span>
        </div>
        <h1 className="headline mt-4 text-4xl sm:text-5xl">{box.slug}</h1>
        <div className="mt-3 flex items-center gap-2">
          <p className="muted truncate text-sm">{box.hostname}</p>
          <button type="button" className="icon-btn h-8 w-8" aria-label="Copy address" onClick={() => void copyHost()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        {data.subscription?.status === "past_due" ? (
          <p className="mt-3 text-sm danger">
            Your last payment failed. Your box stays on while we retry.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => void cancel()}>
              Update your card
            </button>
          </p>
        ) : null}
        {box.error ? <p className="mt-3 text-sm danger">{box.error}</p> : null}
      </section>

      {running && signedIn !== null ? (
        <Link href="/start" className="glass glass-live mt-3 flex items-center justify-between gap-4 p-6 sm:p-8">
          <span>
            <span className="block text-lg font-semibold tracking-tight">{signedIn ? "Start a task" : "Finish setup"}</span>
            <span className="muted mt-1 block text-sm">
              {signedIn ? "Tell Claude what to build. It keeps working when you close this tab." : "Sign in to Claude or ChatGPT. Two taps, no terminal."}
            </span>
          </span>
          <span className="btn btn-sm shrink-0">{signedIn ? "Start" : "Continue"}</span>
        </Link>
      ) : null}

      {running && client && boxStatus && signedIn ? <SessionsCard client={client} status={boxStatus} onStatus={setBoxStatus} /> : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {actions.map((action) => (
          <Link key={action.href} href={action.href} className="glass action-card">
            <span className="icon-blob">{action.icon}</span>
            <span>
              <span className="block font-medium tracking-tight">{action.label}</span>
              <span className="muted text-sm">{action.hint}</span>
            </span>
          </Link>
        ))}
        {/* A plain link: the control plane sends it on to the box with a fresh ticket. */}
        <a href={previewHref()} target="_blank" rel="noopener" className="glass action-card">
          <span className="icon-blob">
            <AppWindow className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-medium tracking-tight">App</span>
            <span className="muted text-sm">Open preview</span>
          </span>
        </a>
        <Link href="/start?add=github" className="glass action-card">
          <span className="icon-blob">
            <GitBranch className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-medium tracking-tight">GitHub</span>
            <span className="muted block text-sm">Bring a repo</span>
          </span>
        </Link>
        <button type="button" className="glass action-card opacity-80" onClick={() => void cancel()}>
          <span className="icon-blob">
            <span className="text-lg leading-none">€</span>
          </span>
          <span>
            <span className="block font-medium tracking-tight">Billing</span>
            <span className="muted text-sm">Card, invoices, cancel</span>
          </span>
        </button>
      </div>
      {message ? <p className="muted mt-4 text-sm">{message}</p> : null}
      {error ? <p className="muted mt-4 text-sm">{error}</p> : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title="Cancel subscription?" description="Your box will be destroyed.">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep
            </Button>
            <Button disabled={pending} onClick={() => void confirmCancel()}>
              Cancel plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
