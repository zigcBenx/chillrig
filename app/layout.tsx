import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://chillrig.jqfdpr2e.workers.dev";
const shareTitle = "Chillrig - your AI coding box, always on";
const shareDescription =
  "Your own cloud computer with Claude Code and Codex. Close your laptop, your agents keep working. Open it from any browser or your phone.";
const shareImage = { url: "/og.png", width: 1200, height: 630, alt: "Chillrig - your AI coding box, always on" };

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Chillrig", template: "%s · Chillrig" },
  description: "Your AI coding box. Always on.",
  applicationName: "Chillrig",
  openGraph: {
    type: "website",
    siteName: "Chillrig",
    url: "/",
    title: shareTitle,
    description: shareDescription,
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: shareTitle,
    description: shareDescription,
    images: [shareImage],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#06070b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
