export function safeNext(value: unknown, fallback = "/go") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/api")) return fallback;
  if (value.includes("://") || value.includes("\\") || value.includes("\n")) return fallback;
  return value;
}
