import "server-only";
import { requireLiveValue } from "@/lib/config";

type HetznerError = Error & { status?: number; code?: string };

async function hetzner(pathname: string, init?: RequestInit) {
  const token = requireLiveValue("HETZNER_API_TOKEN", process.env.HETZNER_API_TOKEN);
  const response = await fetch(`https://api.hetzner.cloud/v1${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: { message?: string; code?: string } }) : {};
  if (!response.ok) {
    const error = new Error(data.error?.message || `Hetzner request failed (${response.status})`) as HetznerError;
    error.status = response.status;
    error.code = data.error?.code;
    throw error;
  }
  return data as Record<string, unknown>;
}

export type CreatedServer = {
  id: number;
  ipv4: string | null;
  /** The server's IPv6 network, e.g. 2a01:4f8:c17:8ade::/64. */
  ipv6?: string | null;
  status: string;
};

export async function createServer(input: {
  name: string;
  userData: string;
  location: string;
  serverType: string;
  firewallIds?: number[];
}) {
  const data = await hetzner("/servers", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      server_type: input.serverType,
      image: "ubuntu-24.04",
      location: input.location,
      start_after_create: true,
      user_data: input.userData,
      public_net: { enable_ipv4: true, enable_ipv6: true },
      // Attach the firewall at create time. Attaching it afterwards fails until the
      // server's public interface exists ("no public network interfaces found").
      ...(input.firewallIds?.length ? { firewalls: input.firewallIds.map((firewall) => ({ firewall })) } : {}),
      labels: {
        chillrig: "1",
        slug: input.name.replace(/^box-/, ""),
        server_type: input.serverType,
        location: input.location,
      },
    }),
  });
  return readServer(data.server);
}

/**
 * The server with this exact name, if any. Hetzner sometimes answers a create with a 5xx
 * ("service unavailable") and still creates the server, so check before moving on.
 */
export async function findServerByName(name: string): Promise<(CreatedServer & { serverType?: string; location?: string }) | null> {
  const data = (await hetzner(`/servers?name=${encodeURIComponent(name)}`)) as {
    servers?: Array<{ server_type?: { name?: string }; datacenter?: { location?: { name?: string } }; location?: { name?: string } }>;
  };
  const server = data.servers?.[0];
  if (!server) return null;
  return {
    ...readServer(server),
    serverType: server.server_type?.name,
    location: server.location?.name ?? server.datacenter?.location?.name,
  };
}

export async function getServer(id: number): Promise<CreatedServer | null> {
  const token = requireLiveValue("HETZNER_API_TOKEN", process.env.HETZNER_API_TOKEN);
  const response = await fetch(`https://api.hetzner.cloud/v1/servers/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  const data = (await response.json()) as { error?: { message?: string }; server?: unknown };
  if (!response.ok) throw new Error(data.error?.message || "Hetzner lookup failed");
  return readServer(data.server);
}

/** Which locations each server type is in stock at right now, or null if Hetzner did not say. */
export async function serverTypeStock(): Promise<Map<string, Set<string>> | null> {
  try {
    const data = (await hetzner("/server_types?per_page=50")) as {
      server_types?: Array<{ name: string; locations?: Array<{ name: string; available?: boolean }> }>;
    };
    const types = data.server_types ?? [];
    if (!types.some((type) => Array.isArray(type.locations))) return null;
    const stock = new Map<string, Set<string>>();
    for (const type of types) {
      stock.set(type.name, new Set((type.locations ?? []).filter((item) => item.available).map((item) => item.name)));
    }
    return stock;
  } catch {
    return null;
  }
}

export type ListedServer = { id: number; name: string; created: string; labels: Record<string, string> };

/** Every server on the project, all pages. */
export async function listServers(): Promise<ListedServer[]> {
  const servers: ListedServer[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = (await hetzner(`/servers?per_page=50&page=${page}`)) as {
      servers?: Array<{ id: number; name: string; created: string; labels?: Record<string, string> }>;
      meta?: { pagination?: { next_page?: number | null } };
    };
    for (const server of data.servers ?? []) {
      servers.push({ id: server.id, name: server.name, created: server.created, labels: server.labels ?? {} });
    }
    if (!data.meta?.pagination?.next_page) break;
  }
  return servers;
}

export type ListedFirewall = { id: number; name: string; created: string; attached: number };

export async function listFirewalls(): Promise<ListedFirewall[]> {
  const data = (await hetzner("/firewalls?per_page=50")) as {
    firewalls?: Array<{ id: number; name: string; created: string; applied_to?: unknown[] }>;
  };
  return (data.firewalls ?? []).map((firewall) => ({
    id: firewall.id,
    name: firewall.name,
    created: firewall.created,
    attached: firewall.applied_to?.length ?? 0,
  }));
}

export async function enableBackup(id: number) {
  await hetzner(`/servers/${id}/actions/enable_backup`, { method: "POST", body: "{}" });
}

export async function deleteServer(id: number) {
  const token = requireLiveValue("HETZNER_API_TOKEN", process.env.HETZNER_API_TOKEN);
  const response = await fetch(`https://api.hetzner.cloud/v1/servers/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 404) return;
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data.error?.message || "Could not delete the server");
  }
}

export async function createFirewall(name: string, serverId?: number) {
  const data = await hetzner("/firewalls", {
    method: "POST",
    body: JSON.stringify({
      name,
      rules: [
        { direction: "in", protocol: "icmp", source_ips: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "80", source_ips: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "443", source_ips: ["0.0.0.0/0", "::/0"] },
      ],
      ...(serverId ? { apply_to: [{ type: "server", server: { id: serverId } }] } : {}),
    }),
  });
  const firewall = data.firewall as { id?: number } | undefined;
  if (!firewall?.id) throw new Error("Hetzner did not return a firewall id");
  return firewall.id;
}

export async function deleteFirewall(id: number) {
  const token = requireLiveValue("HETZNER_API_TOKEN", process.env.HETZNER_API_TOKEN);
  const response = await fetch(`https://api.hetzner.cloud/v1/firewalls/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Could not delete the firewall");
}

/** A firewall stays "in use" for a few seconds after its server is deleted. */
export async function deleteFirewallWhenFree(id: number, attempts = 10) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await deleteFirewall(id);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export function isCapacityError(error: unknown) {
  const code = (error as { code?: string }).code ?? "";
  const status = (error as { status?: number }).status ?? 0;
  return (
    status === 412 ||
    status >= 500 ||
    ["resource_unavailable", "placement_error", "unavailable", "server_type_unavailable"].includes(code)
  );
}

function readServer(value: unknown): CreatedServer {
  const server = value as {
    id?: number;
    status?: string;
    public_net?: { ipv4?: { ip?: string }; ipv6?: { ip?: string } };
  };
  if (!server?.id) throw new Error("Hetzner did not return a server");
  return {
    id: server.id,
    status: server.status ?? "initializing",
    ipv4: server.public_net?.ipv4?.ip ?? null,
    ipv6: server.public_net?.ipv6?.ip ?? null,
  };
}
