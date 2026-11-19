import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-20">
      <div className="glass px-8 py-10 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Not here</h1>
        <Link href="/" className="btn mt-6">
          Home
        </Link>
      </div>
    </main>
  );
}
