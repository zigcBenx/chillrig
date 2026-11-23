#!/bin/bash
# Installs or updates the Chillrig box agent, the browser terminal and the tmux service.
# install.sh runs it once; later the agent (POST /_chillrig/update) runs it again.
# Safe to rerun. It never touches Caddy, the firewall, tmux sessions or the user's files.
#
# By hand on an older box (as root):
#   curl -fsSL https://<control-plane>/box/update.sh | CHILLRIG_CONTROL_PLANE=https://<control-plane> bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

env_get() { sed -n "s/^$1=//p" /etc/chillrig/env 2>/dev/null | tail -1; }
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
for file in agent.mjs login-parse.mjs tasks.mjs attach.sh task.sh; do
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
# Each task session runs task.sh when it starts; replacing it never touches running ones.
put "${tmp}/task.sh" /opt/chillrig/task.sh 0755 || true
if put "${tmp}/agent.mjs" /opt/chillrig/agent.mjs 0644; then agent_changed=1; fi
if put "${tmp}/env" /etc/chillrig/env 0644; then agent_changed=1; fi
if put "${tmp}/chillrig-agent.service" /etc/systemd/system/chillrig-agent.service 0644; then agent_changed=1; fi
if put "${tmp}/attach.sh" /opt/chillrig/attach.sh 0755; then ttyd_changed=1; fi
if put "${tmp}/chillrig-ttyd.service" /etc/systemd/system/chillrig-ttyd.service 0644; then ttyd_changed=1; fi
if put "${tmp}/chillrig-tmux.service" /etc/systemd/system/chillrig-tmux.service 0644; then tmux_changed=1; fi

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
echo "Chillrig box agent is up to date."
