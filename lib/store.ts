import "server-only";
import { isMockMode } from "@/lib/mode";
import { withMock } from "@/lib/mock-db";
import { HttpError } from "@/lib/http";
import { serviceRoleKey, supabaseUrl } from "@/lib/config";
import type { Box, GithubClone, Profile, Subscription } from "@/lib/types";

export type Store = {
  getProfile(id: string): Promise<Profile | null>;
  upsertProfile(profile: Profile): Promise<void>;
  setStripeCustomer(userId: string, customerId: string): Promise<void>;
  getSubscription(userId: string): Promise<Subscription | null>;
  getSubscriptionByStripeId(subscriptionId: string): Promise<Subscription | null>;
  upsertSubscription(subscription: Subscription): Promise<void>;
  getBoxByUser(userId: string): Promise<Box | null>;
  getBoxById(id: string): Promise<Box | null>;
  listSlugs(): Promise<string[]>;
  insertBox(box: Box): Promise<void>;
  saveBox(box: Box): Promise<void>;
  markReady(id: string): Promise<Box | null>;
  consumeProvisionToken(id: string, hash: string): Promise<boolean>;
  claimEvent(id: string): Promise<boolean>;
  releaseEvent(id: string): Promise<void>;
  claimSync(id: string, previous: string | null): Promise<boolean>;
};

type BoxRow = {
  id: string;
  user_id: string;
  slug: string;
  status: Box["status"];
  hetzner_server_id: number | null;
  hetzner_firewall_id: number | null;
  ipv4: string | null;
  region: string;
  server_type: string | null;
  hostname: string | null;
  app_port: number;
  stripe_subscription_id: string | null;
  dns_record_id: string | null;
  provision_token_hash: string | null;
  error: string | null;
  github_clone: GithubClone | null;
  created_at: string;
  ready_at: string | null;
  destroyed_at: string | null;
  last_sync_at: string | null;
  backup_enabled: boolean;
};

function mapBox(row: BoxRow): Box {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    status: row.status,
    hetznerServerId: row.hetzner_server_id,
    hetznerFirewallId: row.hetzner_firewall_id,
    ipv4: row.ipv4,
    region: row.region,
    serverType: row.server_type,
    hostname: row.hostname,
    appPort: row.app_port,
    stripeSubscriptionId: row.stripe_subscription_id,
    dnsRecordId: row.dns_record_id,
    provisionTokenHash: row.provision_token_hash,
    error: row.error,
    githubClone: row.github_clone,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    destroyedAt: row.destroyed_at,
    lastSyncAt: row.last_sync_at,
    backupEnabled: Boolean(row.backup_enabled),
  };
}

function toRow(box: Box): BoxRow {
  return {
    id: box.id,
    user_id: box.userId,
    slug: box.slug,
    status: box.status,
    hetzner_server_id: box.hetznerServerId,
    hetzner_firewall_id: box.hetznerFirewallId,
    ipv4: box.ipv4,
    region: box.region,
    server_type: box.serverType,
    hostname: box.hostname,
    app_port: box.appPort,
    stripe_subscription_id: box.stripeSubscriptionId,
    dns_record_id: box.dnsRecordId,
    provision_token_hash: box.provisionTokenHash,
    error: box.error,
    github_clone: box.githubClone,
    created_at: box.createdAt,
    ready_at: box.readyAt,
    destroyed_at: box.destroyedAt,
    last_sync_at: box.lastSyncAt,
    backup_enabled: box.backupEnabled,
  };
}

async function rest<T>(pathname: string, init: RequestInit & { prefer?: string } = {}) {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url) throw new HttpError(500, "Supabase is not configured");
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.prefer) headers.set("prefer", init.prefer);
  const response = await fetch(`${url}/rest/v1/${pathname}`, { ...init, headers, cache: "no-store" });
  if (response.status === 409) return { status: 409, data: null as T | null };
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      detail = `${body.code ?? ""} ${body.message ?? ""}`.trim();
    } catch {
      detail = "";
    }
    console.error(`supabase ${response.status} ${detail}`.slice(0, 300));
    throw new HttpError(500, "Database error");
  }
  if (response.status === 204) return { status: 204, data: null as T | null };
  const text = await response.text();
  return { status: response.status, data: (text ? (JSON.parse(text) as T) : null) };
}

const mockStore: Store = {
  async getProfile(id) {
    return withMock((state) => state.profiles.find((profile) => profile.id === id) ?? null);
  },
  async upsertProfile(profile) {
    await withMock((state) => {
      const index = state.profiles.findIndex((item) => item.id === profile.id);
      if (index >= 0) state.profiles[index] = profile;
      else state.profiles.push(profile);
    }, true);
  },
  async setStripeCustomer(userId, customerId) {
    await withMock((state) => {
      const profile = state.profiles.find((item) => item.id === userId);
      if (profile) profile.stripeCustomerId = customerId;
    }, true);
  },
  async getSubscription(userId) {
    return withMock((state) => state.subscriptions.find((item) => item.userId === userId) ?? null);
  },
  async getSubscriptionByStripeId(subscriptionId) {
    return withMock(
      (state) => state.subscriptions.find((item) => item.stripeSubscriptionId === subscriptionId) ?? null,
    );
  },
  async upsertSubscription(subscription) {
    await withMock((state) => {
      const index = state.subscriptions.findIndex((item) => item.userId === subscription.userId);
      if (index >= 0) state.subscriptions[index] = subscription;
      else state.subscriptions.push(subscription);
    }, true);
  },
  async getBoxByUser(userId) {
    return withMock((state) => state.boxes.find((box) => box.userId === userId) ?? null);
  },
  async getBoxById(id) {
    return withMock((state) => state.boxes.find((box) => box.id === id) ?? null);
  },
  async listSlugs() {
    return withMock((state) => state.boxes.map((box) => box.slug));
  },
  async insertBox(box) {
    await withMock((state) => {
      if (state.boxes.some((item) => item.userId === box.userId || item.slug === box.slug)) {
        throw new HttpError(409, "A box already exists");
      }
      state.boxes.push(box);
    }, true);
  },
  async saveBox(box) {
    await withMock((state) => {
      const index = state.boxes.findIndex((item) => item.id === box.id);
      if (index < 0) state.boxes.push(box);
      else state.boxes[index] = box;
    }, true);
  },
  async markReady(id) {
    return withMock((state) => {
      const box = state.boxes.find((item) => item.id === id);
      if (!box || box.status !== "provisioning") return null;
      box.status = "running";
      box.readyAt = new Date().toISOString();
      box.error = null;
      box.provisionTokenHash = null;
      return { ...box };
    }, true);
  },
  async consumeProvisionToken(id, hash) {
    return withMock((state) => {
      const box = state.boxes.find((item) => item.id === id);
      if (!box || box.provisionTokenHash !== hash) return false;
      box.provisionTokenHash = null;
      return true;
    }, true);
  },
  async claimEvent(id) {
    return withMock((state) => {
      if (state.events.includes(id)) return false;
      state.events.push(id);
      return true;
    }, true);
  },
  async releaseEvent(id) {
    await withMock((state) => {
      state.events = state.events.filter((eventId) => eventId !== id);
    }, true);
  },
  async claimSync(id, previous) {
    return withMock((state) => {
      const box = state.boxes.find((item) => item.id === id);
      if (!box || box.lastSyncAt !== previous) return false;
      box.lastSyncAt = new Date().toISOString();
      return true;
    }, true);
  },
};

const liveStore: Store = {
  async getProfile(id) {
    const { data } = await rest<ProfileRow[]>(`profiles?id=eq.${encodeURIComponent(id)}&select=*`);
    const row = data?.[0];
    return row
      ? {
          id: row.id,
          email: row.email ?? "",
          name: row.name ?? "",
          provider: row.provider ?? "github",
          avatarUrl: row.avatar_url,
          stripeCustomerId: row.stripe_customer_id,
          createdAt: row.created_at,
        }
      : null;
  },
  async upsertProfile(profile) {
    await rest("profiles?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        avatar_url: profile.avatarUrl,
        provider: profile.provider,
        stripe_customer_id: profile.stripeCustomerId,
        created_at: profile.createdAt,
      }),
    });
  },
  async setStripeCustomer(userId, customerId) {
    await rest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ stripe_customer_id: customerId }),
    });
  },
  async getSubscription(userId) {
    const { data } = await rest<SubRow[]>(`subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*`);
    return data?.[0] ? mapSub(data[0]) : null;
  },
  async getSubscriptionByStripeId(subscriptionId) {
    const { data } = await rest<SubRow[]>(
      `subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*`,
    );
    return data?.[0] ? mapSub(data[0]) : null;
  },
  async upsertSubscription(subscription) {
    await rest("subscriptions?on_conflict=user_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify({
        user_id: subscription.userId,
        stripe_customer_id: subscription.stripeCustomerId,
        stripe_subscription_id: subscription.stripeSubscriptionId,
        status: subscription.status,
        current_period_end: subscription.currentPeriodEnd,
        updated_at: new Date().toISOString(),
      }),
    });
  },
  async getBoxByUser(userId) {
    const { data } = await rest<BoxRow[]>(`boxes?user_id=eq.${encodeURIComponent(userId)}&select=*`);
    return data?.[0] ? mapBox(data[0]) : null;
  },
  async getBoxById(id) {
    const { data } = await rest<BoxRow[]>(`boxes?id=eq.${encodeURIComponent(id)}&select=*`);
    return data?.[0] ? mapBox(data[0]) : null;
  },
  async listSlugs() {
    const { data } = await rest<{ slug: string }[]>("boxes?select=slug");
    return (data ?? []).map((row) => row.slug);
  },
  async insertBox(box) {
    const { status } = await rest("boxes", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify(toRow(box)),
    });
    if (status === 409) throw new HttpError(409, "A box already exists");
  },
  async saveBox(box) {
    await rest(`boxes?id=eq.${encodeURIComponent(box.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify(toRow(box)),
    });
  },
  async markReady(id) {
    const now = new Date().toISOString();
    const { data } = await rest<BoxRow[]>(`boxes?id=eq.${encodeURIComponent(id)}&status=eq.provisioning`, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({
        status: "running",
        ready_at: now,
        error: null,
        provision_token_hash: null,
      }),
    });
    return data?.[0] ? mapBox(data[0]) : null;
  },
  async consumeProvisionToken(id, hash) {
    const { data } = await rest<BoxRow[]>(
      `boxes?id=eq.${encodeURIComponent(id)}&provision_token_hash=eq.${encodeURIComponent(hash)}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ provision_token_hash: null }),
      },
    );
    return Boolean(data && data.length > 0);
  },
  async claimEvent(id) {
    const { status } = await rest("stripe_events", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ id }),
    });
    return status !== 409;
  },
  async releaseEvent(id) {
    await rest(`stripe_events?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
  },
  async claimSync(id, previous) {
    const filter = previous
      ? `last_sync_at=eq.${encodeURIComponent(previous)}`
      : "last_sync_at=is.null";
    const { data } = await rest<BoxRow[]>(`boxes?id=eq.${encodeURIComponent(id)}&${filter}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({ last_sync_at: new Date().toISOString() }),
    });
    return Boolean(data && data.length > 0);
  },
};

type ProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  provider: string | null;
  stripe_customer_id: string | null;
  created_at: string;
};

type SubRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: Subscription["status"];
  current_period_end: string | null;
};

function mapSub(row: SubRow): Subscription {
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  };
}

export function store(): Store {
  return isMockMode() ? mockStore : liveStore;
}
