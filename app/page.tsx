import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowIcon, CheckIcon, CrossIcon, GitHubIcon } from "@/components/icons";
import { LandingBackdrop } from "@/components/landing-backdrop";
import { LogoMark, Mascot } from "@/components/logo";
import { GITHUB_URL } from "@/lib/links";

export const metadata: Metadata = {
  title: "Chillrig",
  description: "Your AI coding box. Always on.",
};

const WIRE = "M0 28 C 60 28, 70 8, 100 28 S 140 48, 200 28";
const WIRE_BACK = "M200 28 C 140 28, 130 48, 100 28 S 60 8, 0 28";

function Wire({ path, delays }: { path: string; delays: [string, string] }) {
  return (
    <div className="wire" aria-hidden>
      <svg width="100%" height="100%" viewBox="0 0 200 56" preserveAspectRatio="none" fill="none">
        <path className="wire-track" d={path} vectorEffect="non-scaling-stroke" />
        <path className="wire-pulse" d={path} pathLength={200} vectorEffect="non-scaling-stroke" style={{ animationDelay: delays[0] }} />
        <path className="wire-spark" d={path} pathLength={200} vectorEffect="non-scaling-stroke" style={{ animationDelay: delays[1] }} />
      </svg>
    </div>
  );
}

function Stroke({ size, width = 1.6, children }: { size: number; width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function Device({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="flow-side">
      <span className="orb orb-lg" aria-hidden>
        <Stroke size={38} width={1.4}>
          {children}
        </Stroke>
      </span>
      <div className="grid gap-1.5">
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
        <p className="muted text-[15px] leading-snug">{text}</p>
      </div>
    </div>
  );
}

/** Staggers a reveal: how far the element has to scroll in before it is fully shown. */
function delay(ms: number) {
  return { "--reveal-end": `${28 + ms / 12}%` } as CSSProperties;
}

function Feature({ title, text, icon, wait, children }: { title: string; text: string; icon: ReactNode; wait: number; children?: ReactNode }) {
  return (
    <div data-reveal style={delay(wait)}>
      <div className="glass tile flex h-full min-h-[248px] flex-col gap-5 p-8">
        <span className="orb" aria-hidden>
          <Stroke size={24}>{icon}</Stroke>
        </span>
        <div className="grid gap-2.5">
          <h3 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h3>
          <p className="muted leading-relaxed text-pretty">{text}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Ticks({ items, off = false, large = false }: { items: string[]; off?: boolean; large?: boolean }) {
  return (
    <ul className={`grid ${large ? "gap-3.5 text-[17px]" : "gap-3"}`}>
      {items.map((item) => (
        <li key={item} className={`flex items-center gap-3 leading-snug ${off ? "muted" : ""}`} style={off ? undefined : { color: "var(--fg-soft)" }}>
          <span className={`tick ${off ? "tick-off" : ""}`} aria-hidden>
            {off ? <CrossIcon /> : <CheckIcon />}
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-[1120px] scroll-mt-20 px-6 pt-[120px] sm:pt-[140px] ${className}`}>
      {children}
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="relative">
      <LandingBackdrop />
      <div className="relative z-[1]">
        <main>
          <section id="top" className="hero mx-auto flex w-full max-w-[1120px] flex-col items-center gap-7 px-6 pt-[180px] text-center">
            <a className="pill rise" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon />
              Open source · Plug and play
            </a>
            <h1 className="display rise">
              Your AI coding box.
              <br />
              Always on.
            </h1>
            <p className="lede rise max-w-[600px]" style={{ fontSize: "clamp(1.0625rem, 1.5vw, 1.375rem)" }}>
              Chillrig puts your Claude and ChatGPT agents on a cloud machine of their own. Close the laptop. They keep working.
            </p>
            <div className="rise flex flex-col items-center gap-4">
              <div className="flex flex-wrap items-center justify-center gap-3.5">
                <Link href="/go" className="btn btn-lg">
                  Get your box
                  <ArrowIcon />
                </Link>
                <a href="#how" className="btn-ghost btn-lg">
                  See how it works
                </a>
              </div>
              <p className="muted text-[15px]">€29 / month · VAT included</p>
            </div>
          </section>

          <Section id="how" className="!pt-[120px]">
            <h2 className="title mb-10 text-center" data-reveal>
              Laptop closed. Agents still working.
            </h2>
            <div className="glass rounded-[40px] p-5" data-reveal style={delay(90)}>
              <div className="flow">
                <Device title="Your laptop" text="Shut the lid. Nothing stops.">
                  <rect x="4" y="5" width="16" height="11" rx="2" />
                  <path d="M2.5 19h19" />
                </Device>
                <Wire path={WIRE} delays={["0s", "-1.3s"]} />
                <div className="flow-box">
                  <span className="relative mb-3.5 inline-flex h-32 w-32 items-center justify-center" aria-hidden>
                    <span className="box-glow" />
                    <Mascot size={168} className="mascot-float" />
                  </span>
                  <div className="flex flex-col items-center gap-3">
                    <div className="grid gap-1.5">
                      <h3 className="text-[22px] font-semibold leading-tight tracking-tight">Your box</h3>
                      <p className="muted text-[15px] leading-snug">Agents and dev server, always on.</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      <span className="chip">Claude</span>
                      <span className="chip">ChatGPT</span>
                    </div>
                  </div>
                </div>
                <Wire path={WIRE_BACK} delays={["-0.65s", "-1.95s"]} />
                <Device title="Your phone" text="Check in from anywhere.">
                  <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
                  <path d="M11 18.5h2" />
                </Device>
              </div>
            </div>
          </Section>

          <Section>
            <div className="mb-12 flex flex-col items-center gap-4 text-center" data-reveal>
              <h2 className="title">
                Don&apos;t buy a €4,000 laptop.
                <br />
                Get a €29 box.
              </h2>
              <p className="lede max-w-[620px]">
                Your agents do the heavy work on your box, not on your laptop. It stays cool, quiet and fast. Any laptop will do.
              </p>
            </div>
            <div className="mx-auto grid max-w-[880px] gap-5 md:grid-cols-2">
              <div className="glass-flat flex flex-col gap-6 p-9" data-reveal>
                <div className="grid gap-2">
                  <p className="muted text-[15px] font-medium">A stronger laptop</p>
                  <p className="muted strike text-[56px] font-semibold leading-none tracking-[-0.05em]">€4,000</p>
                </div>
                <Ticks off items={["Runs hot when agents work all day", "Work stops when the lid closes"]} />
              </div>
              <div className="glass glass-strong flex flex-col gap-6 p-9" data-reveal style={delay(110)}>
                <div className="grid gap-2">
                  <p className="signal text-[15px] font-semibold">Chillrig box</p>
                  <p className="flex items-baseline gap-2.5">
                    <span className="text-[56px] font-semibold leading-none tracking-[-0.05em]">€29</span>
                    <span className="muted text-[17px]">/ month</span>
                  </p>
                </div>
                <Ticks items={["Your laptop stays cool", "Keeps working with the lid closed"]} />
              </div>
            </div>
          </Section>

          <Section>
            <div className="mb-12 flex flex-col items-center gap-4 text-center" data-reveal>
              <h2 className="title">Built for vibe coders, not sysadmins.</h2>
              <p className="lede">No technical stuff. Just plug and play.</p>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <Feature
                wait={0}
                title="Zero setup"
                text="No server setup, no config files. Get your box and start building."
                icon={
                  <>
                    <path d="M9 2.5v5" />
                    <path d="M15 2.5v5" />
                    <path d="M6.5 7.5h11v4a5.5 5.5 0 0 1-11 0z" />
                    <path d="M12 17v4.5" />
                  </>
                }
              />
              <Feature
                wait={100}
                title="A machine that fits"
                text="Pick the machine your project needs. It runs your agents and your dev server."
                icon={
                  <>
                    <rect x="6" y="6" width="12" height="12" rx="2.5" />
                    <path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" />
                  </>
                }
              />
              <Feature
                wait={200}
                title="Open source"
                text="Every line is public. See exactly what runs on your box."
                icon={
                  <>
                    <path d="M8.5 7l-5 5 5 5" />
                    <path d="M15.5 7l5 5-5 5" />
                    <path d="M13.5 5l-3 14" />
                  </>
                }
              >
                <a className="nav-link mt-auto gap-2 px-0 font-semibold" href={GITHUB_URL} target="_blank" rel="noreferrer">
                  View on GitHub
                  <ArrowIcon size={16} />
                </a>
              </Feature>
            </div>
          </Section>

          <Section id="pricing">
            <div className="glass flex flex-wrap items-center justify-between gap-10 rounded-[48px] p-[clamp(28px,5vw,64px)]" data-reveal>
              <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-7">
                <h2 className="title text-left">
                  Get your box.
                  <br />
                  Close your laptop.
                </h2>
                <Ticks large items={["Claude and ChatGPT agents, always on", "Runs your dev server", "Connect from your phone"]} />
              </div>
              <div className="peek-host glass glass-strong flex min-w-0 max-w-[400px] flex-[1_1_300px] flex-col gap-6 p-8">
                <Mascot size={112} className="mascot-peek" />
                <div className="grid gap-2">
                  <p className="flex items-baseline gap-2.5">
                    <span className="text-7xl font-semibold leading-none tracking-[-0.05em]">€29</span>
                    <span className="muted text-lg">/ month</span>
                  </p>
                  <p className="muted text-[15px]">VAT included</p>
                </div>
                <Link href="/go" className="btn btn-lg">
                  Get your box
                  <ArrowIcon />
                </Link>
              </div>
            </div>
          </Section>
        </main>

        <footer className="muted mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 pb-10 pt-24 text-sm">
          <div className="inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-tight" style={{ color: "var(--fg)" }}>
            <LogoMark size={28} />
            Chillrig
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a className="nav-link px-0 text-sm font-normal" href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span>© 2026 Chillrig</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
