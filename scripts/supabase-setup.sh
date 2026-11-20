#!/usr/bin/env bash
# Apply Chillrig migrations and point Supabase Auth at the app URL.
# SUPABASE_ACCESS_TOKEN  account access token (sbp_...)
# SUPABASE_PROJECT_REF   project ref, the id in https://<ref>.supabase.co
# APP_URL                public origin, e.g. https://chillrig.vercel.app
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF}"
: "${APP_URL:?Set APP_URL}"

APP_URL="${APP_URL%/}"
if [[ "$APP_URL" != https://* ]]; then
  echo "APP_URL must start with https://" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
api="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}"

shopt -s nullglob
files=("$root"/supabase/migrations/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No migrations found" >&2
  exit 1
fi

for file in "${files[@]}"; do
  echo "Applying $(basename "$file")"
  python3 - "$file" "$api/database/query" "$SUPABASE_ACCESS_TOKEN" <<'PY'
import json, pathlib, sys, urllib.error, urllib.request

path, url, token = sys.argv[1:]
sql = pathlib.Path(path).read_text()
statements = []
for chunk in sql.split(";"):
    lines = [line for line in chunk.splitlines() if not line.strip().startswith("--")]
    statement = "\n".join(lines).strip()
    if statement:
        statements.append(statement)

def post(statement):
    body = json.dumps({"query": statement}).encode()
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "chillrig-setup",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode("utf-8", "replace")
            if raw.startswith("{"):
                payload = json.loads(raw)
                message = payload.get("message") or payload.get("error")
                if message:
                    raise SystemExit(str(message))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        lowered = detail.lower()
        if error.code in (400, 409) and "already exists" in lowered:
            print("  already exists, continuing")
            return
        sys.stderr.write(detail + "\n")
        raise SystemExit(1)

for statement in statements:
    post(statement)
PY
done

echo "Setting auth site URL to ${APP_URL}"
python3 - "$api/config/auth" "$SUPABASE_ACCESS_TOKEN" "$APP_URL" <<'PY'
import json, sys, urllib.request

url, token, app = sys.argv[1:]
body = json.dumps(
    {
        "site_url": app,
        "uri_allow_list": f"{app}/auth/callback,{app}/**",
    }
).encode()
request = urllib.request.Request(
    url,
    data=body,
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "chillrig-setup",
    },
    method="PATCH",
)
with urllib.request.urlopen(request) as response:
    response.read()
print("Auth redirects include", f"{app}/auth/callback")
PY
