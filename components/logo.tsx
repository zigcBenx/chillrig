import Image from "next/image";
import Link from "next/link";

/** The Chillrig mascot. `size` is the rendered width and height in pixels. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return <Image src="/logo.webp" alt="" width={size} height={size} unoptimized priority className="logo-mark" />;
}

/** The large mascot used as an illustration. */
export function Mascot({ size, className }: { size: number; className?: string }) {
  return <Image src="/mascot.webp" alt="" width={size} height={size} unoptimized className={className} />;
}

export function Logo() {
  return (
    <Link href="/" className="inline-flex h-11 items-center gap-2.5 text-[17px] font-semibold tracking-tight">
      <LogoMark />
      Chillrig
    </Link>
  );
}
