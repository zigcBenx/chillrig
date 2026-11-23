#!/bin/bash
# Installs or updates the Chillrig box agent, the browser terminal and the tmux service.
# install.sh runs it once; later the agent (POST /_chillrig/update) runs it again.
# Safe to rerun. It never touches the firewall, tmux sessions or the user's files.
# Caddy changes only through migrate_caddy below: validated first, rolled back on failure.
#
# By hand on an older box (as root):
#   curl -fsSL https://<control-plane>/box/update.sh | CHILLRIG_CONTROL_PLANE=https://<control-plane> bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

# A fresh box has no /etc/chillrig/env yet. A missing file or key must give "" and
# status 0, or pipefail plus errexit aborts this script (and install.sh with it).
env_get() {
  [[ -f /etc/chillrig/env ]] || return 0
  sed -n "s/^$1=//p" /etc/chillrig/env 2>/dev/null | tail -1 || true
}
CHILLRIG_USER="${CHILLRIG_USER:-$(env_get CHILLRIG_USER)}"
CHILLRIG_USER="${CHILLRIG_USER:-coder}"
CHILLRIG_CONTROL_PLANE="${CHILLRIG_CONTROL_PLANE:-$(env_get CHILLRIG_CONTROL_PLANE)}"
CHILLRIG_CONTROL_PLANE="${CHILLRIG_CONTROL_PLANE%/}"
CHILLRIG_ALLOWED_ORIGINS="${CHILLRIG_ALLOWED_ORIGINS:-$(env_get CHILLRIG_ALLOWED_ORIGINS)}"
CHILLRIG_ASSETS_URL="${CHILLRIG_ASSETS_URL:-$(env_get CHILLRIG_ASSETS_URL)}"
if [[ -z "$CHILLRIG_ASSETS_URL" ]]; then
  if [[ -n "$CHILLRIG_CONTROL_PLANE" ]]; then
    CHILLRIG_ASSETS_URL="${CHILLRIG_CONTROL_PLANE}/box"
  else
    CHILLRIG_ASSETS_URL="https://raw.githubusercontent.com/zigcBenx/chillrig/main/public/box"
  fi
fi
CHILLRIG_ASSETS_URL="${CHILLRIG_ASSETS_URL%/}"

if [[ ! "$CHILLRIG_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || ! id "$CHILLRIG_USER" >/dev/null 2>&1; then
  echo "CHILLRIG_USER must be an existing user." >&2
  exit 1
fi
for value in "$CHILLRIG_CONTROL_PLANE" "$CHILLRIG_ASSETS_URL"; do
  if [[ -n "$value" && ! "$value" =~ ^https://[A-Za-z0-9.:/_-]+$ ]]; then
    echo "URLs must be plain https:// URLs." >&2
    exit 1
  fi
done
if [[ -n "$CHILLRIG_ALLOWED_ORIGINS" && ! "$CHILLRIG_ALLOWED_ORIGINS" =~ ^[A-Za-z0-9.:/,_-]+$ ]]; then
  echo "CHILLRIG_ALLOWED_ORIGINS must be a comma-separated list of origins." >&2
  exit 1
fi

home="/home/${CHILLRIG_USER}"
install -d -m 0755 /opt/chillrig /etc/chillrig /var/lib/chillrig
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Fetch everything first and check it, so a bad download never replaces a working agent.
for file in agent.mjs login-parse.mjs tasks.mjs preview.mjs attach.sh task.sh; do
  if [[ -n "${CHILLRIG_ASSETS_DIR:-}" ]]; then
    cp "${CHILLRIG_ASSETS_DIR}/${file}" "${tmp}/${file}"
  else
    curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors --max-time 60 \
      -o "${tmp}/${file}" "${CHILLRIG_ASSETS_URL}/${file}"
  fi
done
node --check "${tmp}/agent.mjs"
node --check "${tmp}/login-parse.mjs"
node --check "${tmp}/tasks.mjs"
node --check "${tmp}/preview.mjs"
bash -n "${tmp}/attach.sh"
bash -n "${tmp}/task.sh"
grep -q "AGENT_VERSION" "${tmp}/agent.mjs"

cat > "${tmp}/env" << EOF
CHILLRIG_USER=${CHILLRIG_USER}
CHILLRIG_CONTROL_PLANE=${CHILLRIG_CONTROL_PLANE}
CHILLRIG_ASSETS_URL=${CHILLRIG_ASSETS_URL}
CHILLRIG_ALLOWED_ORIGINS=${CHILLRIG_ALLOWED_ORIGINS}
EOF

user_path="${home}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# The tmux server lives in its own unit. Restarting the agent or ttyd never ends a
# session, and KillMode=process here means stopping this unit does not either.
cat > "${tmp}/chillrig-tmux.service" << EOF
[Unit]
Description=Chillrig tmux server (sessions outlive the terminal and the agent)
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${CHILLRIG_USER}
Group=${CHILLRIG_USER}
WorkingDirectory=${home}
Environment=HOME=${home}
Environment=LANG=C.UTF-8
Environment=PATH=${user_path}
ExecStart=/bin/sh -c '/usr/bin/tmux has-session -t chillrig 2>/dev/null || /usr/bin/tmux new-session -d -s chillrig -c ${home}; /usr/bin/tmux set-option -s exit-empty off'
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

cat > "${tmp}/chillrig-agent.service" << EOF
[Unit]
Description=Chillrig box agent
After=network-online.target chillrig-tmux.service
Wants=chillrig-tmux.service

[Service]
Type=simple
EnvironmentFile=/etc/chillrig/env
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/node /opt/chillrig/agent.mjs
Restart=always
RestartSec=2
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

# -a: the browser may add ?arg=<session> to pick a task session; attach.sh validates it.
# Restarting ttyd only drops the browser connections; sessions live in chillrig-tmux.
cat > "${tmp}/chillrig-ttyd.service" << EOF
[Unit]
Description=Chillrig terminal
After=network-online.target chillrig-tmux.service
Wants=chillrig-tmux.service

[Service]
Type=simple
User=${CHILLRIG_USER}
Group=${CHILLRIG_USER}
WorkingDirectory=${home}
Environment=HOME=${home}
Environment=LANG=C.UTF-8
Environment=PATH=${user_path}
ExecStart=/usr/local/bin/ttyd -W -a -i 127.0.0.1 -p 7681 -b /ttyd -m 4 -H X-Chillrig-Auth /opt/chillrig/attach.sh
Restart=on-failure
RestartSec=2
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

# put SRC DEST MODE: replace DEST only when it differs; exit status 0 means "changed".
put() {
  if cmp -s "$1" "$2"; then
    return 1
  fi
  install -m "$3" "$1" "$2.chillrig-new"
  mv -f "$2.chillrig-new" "$2"
}

agent_changed=0
ttyd_changed=0
tmux_changed=0
if put "${tmp}/login-parse.mjs" /opt/chillrig/login-parse.mjs 0644; then agent_changed=1; fi
if put "${tmp}/tasks.mjs" /opt/chillrig/tasks.mjs 0644; then agent_changed=1; fi
if put "${tmp}/preview.mjs" /opt/chillrig/preview.mjs 0644; then agent_changed=1; fi
# Each task session runs task.sh when it starts; replacing it never touches running ones.
put "${tmp}/task.sh" /opt/chillrig/task.sh 0755 || true
if put "${tmp}/agent.mjs" /opt/chillrig/agent.mjs 0644; then agent_changed=1; fi
if put "${tmp}/env" /etc/chillrig/env 0644; then agent_changed=1; fi
if put "${tmp}/chillrig-agent.service" /etc/systemd/system/chillrig-agent.service 0644; then agent_changed=1; fi
if put "${tmp}/attach.sh" /opt/chillrig/attach.sh 0755; then ttyd_changed=1; fi
if put "${tmp}/chillrig-ttyd.service" /etc/systemd/system/chillrig-ttyd.service 0644; then ttyd_changed=1; fi
if put "${tmp}/chillrig-tmux.service" /etc/systemd/system/chillrig-tmux.service 0644; then tmux_changed=1; fi

# The app preview is private by default: Caddy's app route imports this file, which asks
# the agent (on localhost) about the preview cookie. The agent rewrites it when the owner
# makes the preview public, so an existing file is never replaced.
if [[ ! -f /etc/chillrig/preview.caddy ]]; then
  cat > "${tmp}/preview.caddy" << 'EOF'
# Chillrig: the app preview is private. The box agent checks the preview cookie.
forward_auth 127.0.0.1:7682 {
	uri /_chillrig/preview/check
}
EOF
  install -m 0644 "${tmp}/preview.caddy" /etc/chillrig/preview.caddy
fi

systemctl daemon-reload
systemctl enable chillrig-tmux.service chillrig-agent.service chillrig-ttyd.service >/dev/null 2>&1

# install.sh starts the services itself once the firewall is up.
if [[ "${CHILLRIG_UPDATE_NO_START:-}" == "1" ]]; then
  exit 0
fi
# Never restart chillrig-tmux: start is a no-op when it already runs.
systemctl start chillrig-tmux.service
if [[ "$tmux_changed" == "1" ]]; then
  echo "chillrig-tmux unit updated; it applies the next time the box boots."
fi
if [[ "$agent_changed" == "1" ]] || ! systemctl is-active --quiet chillrig-agent.service; then
  systemctl restart chillrig-agent.service
fi
if [[ "$ttyd_changed" == "1" ]] || ! systemctl is-active --quiet chillrig-ttyd.service; then
  systemctl restart chillrig-ttyd.service
fi

# Boxes from before agent v4 send every app request straight to the app port. This adds
# the preview check and the waiting page to each Caddy template and changes nothing else:
# domain, ACME email, __APP_PORT__ and the /_chillrig and /ttyd auth stay as they are.
# Writes <template>.chillrig-new for each template that needs it; exit 1 when a template
# does not look like one install.sh wrote (then nothing changes).
read -r -d '' MIGRATE_CADDY << 'JS' || true
const fs = require("fs");
const OLD = "\thandle {\n\t\treverse_proxy 127.0.0.1:__APP_PORT__\n\t}\n";
const NEW = [
  "\thandle {",
  "\t\timport /etc/chillrig/preview.caddy",
  "\t\treverse_proxy 127.0.0.1:__APP_PORT__",
  "\t}",
  "",
  "\thandle_errors 502 503 504 {",
  "\t\t@preview not path /_chillrig/* /ttyd/*",
  "\t\thandle @preview {",
  "\t\t\trewrite * /_chillrig/preview/waiting",
  "\t\t\treverse_proxy 127.0.0.1:7682",
  "\t\t}",
  "\t}",
  "",
].join("\n");
for (const file of process.argv.slice(1)) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("import /etc/chillrig/preview.caddy")) continue;
  if (text.split(OLD).length !== 2) process.exit(1);
  fs.writeFileSync(file + ".chillrig-new", text.replace(OLD, NEW), { mode: 0o644 });
}
JS

migrate_caddy() {
  local active=/etc/chillrig/Caddyfile.tmpl live=/etc/caddy/Caddyfile
  if [[ ! -f "$active" || ! -f "$live" || ! -f /etc/chillrig/preview.caddy ]] || ! command -v caddy >/dev/null 2>&1; then
    return 0
  fi
  local templates=() backed_up=() file port from changed=0
  for file in /etc/chillrig/Caddyfile.http.tmpl /etc/chillrig/Caddyfile.https.tmpl "$active"; do
    if [[ -f "$file" ]]; then templates+=("$file"); fi
  done
  rm -f /etc/chillrig/*.chillrig-new "${live}.chillrig-next"
  if ! node -e "$MIGRATE_CADDY" "${templates[@]}"; then
    echo "Caddy templates look different from what this update knows; left them as they are."
    rm -f /etc/chillrig/*.chillrig-new
    return 0
  fi
  port=$(tr -d '[:space:]' < /etc/chillrig/app_port 2>/dev/null || true)
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then port=3000; fi
  for file in "${templates[@]}"; do
    if [[ -f "${file}.chillrig-new" ]]; then changed=1; fi
  done
  from="$active"
  if [[ -f "${active}.chillrig-new" ]]; then from="${active}.chillrig-new"; fi
  sed "s/__APP_PORT__/${port}/g" "$from" > "${live}.chillrig-next"
  if [[ "$changed" == "0" ]] && cmp -s "${live}.chillrig-next" "$live"; then
    rm -f "${live}.chillrig-next"
    return 0
  fi
  if ! HOME=/root caddy validate --config "${live}.chillrig-next" --adapter caddyfile >/dev/null 2>&1; then
    echo "The new Caddy config did not validate; kept the old one."
    rm -f "${live}.chillrig-next" /etc/chillrig/*.chillrig-new
    return 0
  fi
  for file in "${templates[@]}"; do
    if [[ -f "${file}.chillrig-new" ]]; then
      cp -p "$file" "${file}.chillrig-bak"
      backed_up+=("$file")
      mv -f "${file}.chillrig-new" "$file"
    fi
  done
  cp -p "$live" "${live}.chillrig-bak"
  backed_up+=("$live")
  mv -f "${live}.chillrig-next" "$live"
  if systemctl is-active --quiet caddy && ! HOME=/root caddy reload --config "$live" --adapter caddyfile >/dev/null 2>&1; then
    echo "Caddy did not take the new config; putting the old one back."
    for file in "${backed_up[@]}"; do
      mv -f "${file}.chillrig-bak" "$file"
    done
    HOME=/root caddy reload --config "$live" --adapter caddyfile >/dev/null 2>&1 || systemctl restart caddy || true
    return 0
  fi
  echo "The app preview is private now."
}

# The new agent answers the preview check. Wait for it before Caddy starts asking; if it
# does not come up, leave Caddy alone and try again on the next update.
agent_up=0
for _ in $(seq 1 20); do
  if (exec 3<>/dev/tcp/127.0.0.1/7682) 2>/dev/null; then agent_up=1; break; fi
  sleep 0.5
done
if [[ "$agent_up" == "1" ]]; then
  migrate_caddy
else
  echo "The box agent is not answering yet; Caddy was left as it is."
fi
echo "Chillrig box agent is up to date."
