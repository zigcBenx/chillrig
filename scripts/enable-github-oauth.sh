#!/usr/bin/env bash
# Turn on "Continue with GitHub" for the live Supabase project.
# 1. Create a GitHub OAuth App (github.com/settings/developers -> New OAuth App):
#      Homepage URL:               https://chillrig.jqfdpr2e.workers.dev
#      Authorization callback URL: https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
# 2. Run: scripts/enable-github-oauth.sh <client_id> <client_secret>
# The login page shows the button within 5 minutes (CHILLRIG_OAUTH=1 is already set).
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -eq 2 ] || { echo "usage: $0 <github_client_id> <github_client_secret>" >&2; exit 1; }
set -a; . ./.env.local; set +a
curl -fsS -X PATCH "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d "{\"external_github_enabled\":true,\"external_github_client_id\":\"$1\",\"external_github_secret\":\"$2\"}" >/dev/null
# The public settings endpoint lags the change by up to a minute; wait for it.
for _ in $(seq 1 20); do
  if curl -fsS -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" "${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings" | grep -q '"github":true'; then
    echo '"github":true'; exit 0
  fi
  sleep 5
done
echo 'Saved, but Supabase still reports "github":false after 100s. Check again in a few minutes.' >&2
exit 1
