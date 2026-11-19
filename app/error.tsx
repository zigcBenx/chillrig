"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-20">
      <div className="glass max-w-sm px-8 py-10 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <button type="button" className="btn mt-6" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
