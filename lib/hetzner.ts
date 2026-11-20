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
  status: string;
};

export async function createServer(input: {
  name: string;
  userData: string;
  location: string;
  serverType: string;
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

export async function createFirewall(name: string, serverId: number) {
  const data = await hetzner("/firewalls", {
    method: "POST",
    body: JSON.stringify({
      name,
      rules: [
        { direction: "in", protocol: "icmp", source_ips: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "80", source_ips: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "443", source_ips: ["0.0.0.0/0", "::/0"] },
      ],
      apply_to: [{ type: "server", server: { id: serverId } }],
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
    public_net?: { ipv4?: { ip?: string } };
  };
  if (!server?.id) throw new Error("Hetzner did not return a server");
  return {
    id: server.id,
    status: server.status ?? "initializing",
    ipv4: server.public_net?.ipv4?.ip ?? null,
  };
}
