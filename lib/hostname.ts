export function sslipHostname(ipv4: string) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ipv4)) return null;
  const parts = ipv4.split(".");
  if (parts.some((part) => Number(part) > 255)) return null;
  return `${parts.join("-")}.sslip.io`;
}

export function cloudflareConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

export function boxHostname(box: { hostname?: string | null; slug: string }, domain: string) {
  return box.hostname || `${box.slug}.${domain}`;
}
