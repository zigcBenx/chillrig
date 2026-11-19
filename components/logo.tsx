import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[#1d1d1f] dark:bg-white">
        <span className="pulse h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
      </span>
      Chillrig
    </Link>
  );
}
