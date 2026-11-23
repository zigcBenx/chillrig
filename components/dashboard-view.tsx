"use client";

import { subscriptionAllowsBox } from "@/lib/billing-policy";
import { OrbitIcon, SparkIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/components/use-account";
import { AppWindow, Check, Copy, GitBranch, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function DashboardView() {
  const router = useRouter();
  const { data, error } = useAccount(4000);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

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

  async function cloneRepo() {
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/boxes/clone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = (await response.json()) as { error?: string; clone?: { path: string } };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error ?? "Clone failed");
      return;
    }
    setCloneOpen(false);
    setUrl("");
    window.location.reload();
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
  const running = box.status === "running";
  const actions = [
    { href: "/connect/claude", label: "Claude", hint: "Connect", icon: <SparkIcon /> },
    { href: "/connect/chatgpt", label: "ChatGPT", hint: "Connect", icon: <OrbitIcon /> },
    { href: "/terminal", label: "Terminal", hint: "Open", icon: <Terminal className="h-6 w-6" /> },
    { href: "/preview", label: "App", hint: "Open", icon: <AppWindow className="h-6 w-6" /> },
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
          <p className="mt-3 text-sm danger">Payment failed</p>
        ) : null}
        {box.error ? <p className="mt-3 text-sm danger">{box.error}</p> : null}
      </section>

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
        <button type="button" className="glass action-card" onClick={() => setCloneOpen(true)}>
          <span className="icon-blob">
            <GitBranch className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-medium tracking-tight">GitHub</span>
            <span className="muted block max-w-full truncate text-sm">{box.clone?.path ?? "Clone"}</span>
          </span>
        </button>
        <button type="button" className="glass action-card opacity-80" onClick={() => void cancel()}>
          <span className="icon-blob">
            <span className="text-lg leading-none">×</span>
          </span>
          <span>
            <span className="block font-medium tracking-tight">Cancel</span>
            <span className="muted text-sm">Plan</span>
          </span>
        </button>
      </div>
      {message ? <p className="muted mt-4 text-sm">{message}</p> : null}
      {error ? <p className="muted mt-4 text-sm">{error}</p> : null}

      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent title="Clone" description="Public GitHub repository.">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void cloneRepo();
            }}
          >
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/you/repo"
              aria-label="Repository URL"
              autoComplete="off"
            />
            <Button disabled={pending || !url.trim()}>Clone</Button>
            {message ? <p className="text-sm danger">{message}</p> : null}
          </form>
        </DialogContent>
      </Dialog>

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
