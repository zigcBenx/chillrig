const BLOCKED = new Set([7681, 7682]);

export function parseAppPort(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < 1024 || number > 65535 || BLOCKED.has(number)) return null;
  return number;
}
