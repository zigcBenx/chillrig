-- Chillrig control-plane schema.
-- One person, one subscription, one box. Writes go through the service role.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  provider text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.boxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  slug text not null unique,
  status text not null check (status in ('provisioning', 'waiting', 'running', 'destroying', 'destroyed', 'error')),
  hetzner_server_id bigint,
  hetzner_firewall_id bigint,
  ipv4 text,
  region text not null default 'fsn1',
  app_port integer not null default 3000,
  stripe_subscription_id text,
  dns_record_id text,
  provision_token_hash text,
  error text,
  github_clone jsonb,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  destroyed_at timestamptz,
  last_sync_at timestamptz,
  backup_enabled boolean not null default false
);

create table if not exists public.stripe_events (
  id text primary key,
  received_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.boxes enable row level security;
alter table public.stripe_events enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "read own subscription" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

create policy "read own box" on public.boxes
  for select to authenticated using (auth.uid() = user_id);
