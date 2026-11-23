import Link from "next/link";
import type { ReactNode } from "react";
import { COMPANY, SUPPORT_EMAIL } from "@/lib/links";

export const LEGAL_UPDATED = "23 November 2026";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-28">
      <Link href="/" className="muted text-sm underline underline-offset-2">
        ← Chillrig
      </Link>
      <h1 className="headline mt-6 text-4xl">{title}</h1>
      <p className="muted mt-2 text-sm">Last updated {LEGAL_UPDATED}</p>
      <div className="legal mt-10 space-y-5 text-[15px] leading-7 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">
        {children}
      </div>
      <p className="muted mt-12 text-sm">
        {COMPANY.name}, {COMPANY.country} · <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </main>
  );
}
