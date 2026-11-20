# Chillrig

An always-on cloud computer for people who already pay for Claude or ChatGPT. Claude Code and Codex run on a private VM, not on a laptop.

The control plane is a Next.js app. Each subscriber gets one Hetzner CX33 in the EU. The official CLIs log in on that machine. Chillrig never sees the credentials.

## Run the demo

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

Development is mock mode unless `CHILLRIG_MOCK=false`. Sign in, pay, and provision are simulated. The terminal is drawn in the browser. Keystrokes are not sent anywhere. No Stripe, Supabase, or Hetzner keys are required.

```bash
npm test
npm run lint
npm run build
```

## Product

1. Landing page, one screen.
2. Sign in with Google or GitHub (Supabase Auth).
3. Stripe Checkout, one plan, €29/month, VAT included in the price you create. The customer portal cancels the plan.
4. `checkout.session.completed` provisions one Ubuntu 24.04 CX33 in `fsn1`, falling back to `hel1`, with backups and a Hetzner firewall. The dashboard shows setup progress. Resend can email when the machine calls home.
5. Dashboard: status, Connect Claude, Connect ChatGPT, terminal, app preview, GitHub clone, cancel.
6. Connect opens the browser terminal and can start `claude` or `codex login --device-auth`. Reconnect runs that command again. There is no `claude setup-token` flow.
7. The terminal is ttyd attached to a tmux session, so closing the tab does not stop a running agent.
8. `https://<slug>.<domain>` proxies to the app port on the box (3000 by default).

One person, one subscription, one box. Cancel deletes the server and its IPv4. A failed invoice marks the subscription past due and leaves the box running while Stripe retries.

## Security model

- Provider login happens only inside the unmodified official CLIs, on the subscriber's VM.
- The control plane does not collect, store, proxy, or log those credentials. It does not log PTY output.
- ttyd binds to `127.0.0.1`. Caddy is the only public TLS endpoint. It `forward_auth`s to the control plane with a 90-second signed ticket, then adds an internal header ttyd requires. A request that reaches ttyd without that header is refused.
- Managed boxes get a Hetzner firewall with ports 80 and 443 only, plus host `ufw` and SSH password login disabled. Set `CHILLRIG_CLOSE_SSH=1` for the same lock on a self-hosted box.
- DNS records are Cloudflare A records, DNS-only, so Caddy can use Let's Encrypt. Each VM has its own address, so a wildcard record cannot replace the per-box record.
- The ready callback token can only mark that one box ready, expires in two hours, and is single-use. It is not a user credential.

## Go live

Set every variable in [`.env.example`](.env.example) on the host. Leave `CHILLRIG_MOCK` unset or `false`. `CHILLRIG_CONTROL_PLANE` must be the public `https` origin of this app, because the VM calls it.

### Supabase

1. Create a project and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) in the SQL editor.
2. Enable the Google and GitHub providers.
3. Add `https://<your-app>/auth/callback` to the redirect allow list.
4. Put the project URL, anon key, and service role key in the environment. The service role is server-only.

### Stripe

1. Create a recurring EUR price of €29 with tax behavior **inclusive**.
2. Leave automatic tax off, so checkout does not add VAT on top of the displayed price.
3. Point a webhook at `https://<your-app>/api/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
4. Turn on the Customer Portal and allow cancellation. The dashboard Cancel button opens it. In mock mode, Cancel destroys the demo box directly.

### Hetzner and Cloudflare

The API token needs permission to create servers, enable backups, and manage firewalls. The default machine is `cx33` (4 vCPU, 8 GB, about €8.49–€8.99/month). If Hetzner returns `resource_unavailable`, the control plane tries that type in `fsn1`, `nbg1`, and `hel1`, then `cax21` (€10.99) and `cx23` (€5.99). Nothing above `HETZNER_MAX_MONTHLY_EUR` (default €12) is chosen. If every allowed type is full, the box waits and retries about once a minute instead of failing.

The Cloudflare token needs DNS edit on the zone in `CLOUDFLARE_ZONE_ID`. Records are created with `proxied: false`.

### Deploy on Vercel without a domain

`vercel.json` marks this as a Next.js app and gives the Stripe webhook, checkout, and ready callback 60 seconds. From the repo:

```bash
npx vercel deploy --prod --token "$VERCEL_TOKEN" --yes
```

Set `CHILLRIG_MOCK=false` for that production deployment. After the first deploy, set `NEXT_PUBLIC_APP_URL` and `CHILLRIG_CONTROL_PLANE` to the stable `https://<project>.vercel.app` origin and redeploy so the VM and Stripe call that host, not a one-off deployment URL. If those two are empty, the app falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`. Checkout, the Stripe webhook (`/api/webhooks/stripe`), and the box ready callback (`/api/boxes/ready`) use that origin. No custom domain is required.

Leave `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` unset. Each new machine is named `<ip-with-dashes>.sslip.io` (for example `1-2-3-4.sslip.io`). That name is stored on the box, Caddy requests a Let's Encrypt certificate for it, and the terminal and preview use it. `sslip.io` is a shared domain, so a long test can hit Let's Encrypt's certificate limit for that name. Set `ACME_EMAIL` to a real address.

Required production env: `CHILLRIG_MOCK=false`, `SESSION_SECRET`, `TERMINAL_TOKEN_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `HETZNER_API_TOKEN`. For the first sign-in, set `CHILLRIG_EMAIL_LOGIN=1` and leave Google and GitHub unconfigured. Cloudflare and `CHILLRIG_DOMAIN` are optional until you buy a domain. `STRIPE_PORTAL_CONFIGURATION` is optional; the setup script prints it.

Apply the database and auth redirects, then create the test price and webhook:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=... APP_URL=https://<project>.vercel.app npm run supabase-setup
STRIPE_SECRET_KEY=sk_test_... APP_URL=https://<project>.vercel.app npm run stripe-setup
```

`scripts/supabase-setup.sh` runs `supabase/migrations/0001_init.sql` through `0004_hostname.sql` with the Management API and sets the auth site URL plus `/auth/callback`. `scripts/stripe-setup.ts` creates the €29/month VAT-inclusive price, a webhook for the four billing events, and a Customer Portal configuration. It prints `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PORTAL_CONFIGURATION`. It refuses a live secret key. Re-running it replaces the webhook for that URL so a new signing secret can be printed.

The VM install script is traced into the server bundle from `install.sh`. The first `invoice.payment_failed` marks the subscription past due, emails the subscriber when Resend is configured, and does not delete the VM. The VM is deleted when Stripe sends `customer.subscription.deleted` or the subscription becomes `canceled`, `unpaid`, or `incomplete_expired`. Processed event ids are stored so a webhook retry does not create a second machine.

### Email

If `RESEND_API_KEY` and `EMAIL_FROM` are set, the subscriber gets one email when the box is marked ready, and a warning when a payment fails. Without them, the dashboard still updates.

## Self-host the box

`install.sh` is the same bootstrap the control plane sends as cloud-init. On Ubuntu 24.04:

```bash
sudo CHILLRIG_DOMAIN=box.example.com bash install.sh
```

That installs Node 22, git, GitHub CLI, Docker, tmux, Caddy, ttyd, and the official `@anthropic-ai/claude-code` and `@openai/codex` packages, under an unprivileged `coder` user. Without `CHILLRIG_CONTROL_PLANE`, the terminal is behind a generated basic-auth password printed once.

Managed mode (what the control plane sets):

```bash
sudo \
  CHILLRIG_DOMAIN=calm-otter.example.com \
  CHILLRIG_CONTROL_PLANE=https://app.example.com \
  CHILLRIG_CLOSE_SSH=1 \
  bash install.sh
```

## Layout

- `app/` control-plane UI and HTTP routes
- `lib/` auth, billing, provisioning, and the mock database
- `install.sh` box bootstrap
- `supabase/migrations/` Postgres schema (`0001` through `0004`)
- `scripts/supabase-setup.sh` and `scripts/stripe-setup.ts` for a first live deploy

Mock state is stored in `.data/` (or `/tmp/chillrig` on Vercel). It is gitignored.

## Risks

- The box stays up through Stripe's payment retries and is deleted only after the subscription is canceled or unpaid. A webhook that never arrives leaves the machine running.
- Terminal tickets travel in the WebSocket query string for about 90 seconds. Caddy access logs are left off. Turning them on would record those tickets on the VM.
- The ready token is removed from cloud-init user-data after the callback. Until that runs, it can only mark that one box ready.
- If every type under the monthly cap is unavailable, the box stays in "Waiting for capacity" and is created when a slot opens. Opening the setup page retries about once a minute.
- Two checkout webhooks arriving in the same moment rely on the one-box database constraint. A crash after Hetzner accepts a server but before the id is saved could orphan a machine; the next sync adopts or the error path deletes known ids.
- Preview iframes the subscriber's own app. It is a different site from the control plane, so it does not receive the Chillrig session cookie.
- Upstream package names for Claude Code and Codex can change. `install.sh` installs the current official npm packages.
