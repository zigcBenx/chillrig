"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {ready ? dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" /> : <span className="h-[18px] w-[18px]" />}
    </button>
  );
}
