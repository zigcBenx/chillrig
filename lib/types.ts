export type Provider = "google" | "github";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  provider: string;
};

export type BoxStatus =
  | "provisioning"
  | "running"
  | "destroying"
  | "destroyed"
  | "error";

export type GithubClone = {
  url: string;
  path: string;
  at: string;
};

export type Profile = SessionUser & {
  avatarUrl: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
};

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "incomplete";

export type Subscription = {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
};

export type Box = {
  id: string;
  userId: string;
  slug: string;
  status: BoxStatus;
  hetznerServerId: number | null;
  hetznerFirewallId: number | null;
  ipv4: string | null;
  region: string;
  serverType: string | null;
  appPort: number;
  stripeSubscriptionId: string | null;
  dnsRecordId: string | null;
  provisionTokenHash: string | null;
  error: string | null;
  githubClone: GithubClone | null;
  createdAt: string;
  readyAt: string | null;
  destroyedAt: string | null;
  lastSyncAt: string | null;
  backupEnabled: boolean;
};

export type StepState = "done" | "current" | "todo";

export type AccountView = {
  mock: boolean;
  user: SessionUser;
  subscription: { status: SubscriptionStatus } | null;
  box: null | {
    slug: string;
    status: BoxStatus;
    hostname: string;
    appPort: number;
    error: string | null;
    clone: { url: string; path: string } | null;
  };
  steps: { id: string; label: string; state: StepState }[];
  previewUrl: string | null;
};
