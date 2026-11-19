import "server-only";
import { requireLiveValue } from "@/lib/config";

async function cloudflare(pathname: string, init?: RequestInit) {
  const token = requireLiveValue("CLOUDFLARE_API_TOKEN", process.env.CLOUDFLARE_API_TOKEN);
  const zone = requireLiveValue("CLOUDFLARE_ZONE_ID", process.env.CLOUDFLARE_ZONE_ID);
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json()) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: { id?: string };
  };
  if (!response.ok || data.success === false) {
    throw new Error(data.errors?.[0]?.message || "Cloudflare request failed");
  }
  return data;
}

export async function createDnsRecord(slug: string, ipv4: string) {
  const data = await cloudflare("/dns_records", {
    method: "POST",
    body: JSON.stringify({
      type: "A",
      name: slug,
      content: ipv4,
      ttl: 1,
      proxied: false,
      comment: "chillrig",
    }),
  });
  if (!data.result?.id) throw new Error("Cloudflare did not return a record id");
  return data.result.id;
}

export async function deleteDnsRecord(id: string) {
  const token = requireLiveValue("CLOUDFLARE_API_TOKEN", process.env.CLOUDFLARE_API_TOKEN);
  const zone = requireLiveValue("CLOUDFLARE_ZONE_ID", process.env.CLOUDFLARE_ZONE_ID);
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Could not delete the DNS record");
}
