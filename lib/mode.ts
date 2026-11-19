/**
 * Server-side mode switch. Do not import this from client components:
 * non-public env vars are empty in the browser bundle.
 *
 * Development without CHILLRIG_MOCK=false runs the whole product in mock mode.
 * Production stays live unless mock mode is explicitly enabled.
 */
export function isMockMode() {
  const flag = process.env.CHILLRIG_MOCK?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return process.env.NODE_ENV !== "production";
}

export function mockProvisionMs() {
  const parsed = Number(process.env.CHILLRIG_MOCK_PROVISION_MS);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed < 120000) return parsed;
  return 7000;
}
