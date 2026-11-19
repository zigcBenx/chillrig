import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Chillrig",
  description: "Your AI coding box. Always on.",
};

export default function HomePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 pb-12 pt-24">
      <div className="rise glass w-full max-w-xl px-7 py-12 text-center sm:px-14 sm:py-16">
        <p className="text-sm font-medium tracking-tight">Chillrig</p>
        <h1 className="headline mx-auto mt-5 max-w-md text-[2.45rem] sm:text-6xl">
          Your AI coding box.
          <br />
          Always on.
        </h1>
        <p className="muted mx-auto mt-5 max-w-xs text-[15px]">Claude and ChatGPT. In the cloud.</p>
        <Link href="/go" className="btn mt-8">
          Get your box
        </Link>
        <p className="muted mt-4 text-sm">€29 / month · VAT included</p>
      </div>
    </main>
  );
}
