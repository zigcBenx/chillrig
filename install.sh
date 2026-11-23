#!/bin/bash
# Chillrig box bootstrap for Ubuntu 24.04.
# Managed boxes are started from the control plane with env vars already exported.
# Self-host: sudo CHILLRIG_DOMAIN=box.example.com bash install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ "${CHILLRIG_LOGGING:-}" != "1" ]]; then
  export CHILLRIG_LOGGING=1
  touch /var/log/chillrig-install.log
  chmod 600 /var/log/chillrig-install.log
  exec > >(tee -a /var/log/chillrig-install.log) 2>&1
fi
trap '' HUP

export DEBIAN_FRONTEND=noninteractive
CHILLRIG_USER="${CHILLRIG_USER:-coder}"
CHILLRIG_APP_PORT="${CHILLRIG_APP_PORT:-3000}"
CHILLRIG_DOMAIN="${CHILLRIG_DOMAIN:-}"
CHILLRIG_CONTROL_PLANE="${CHILLRIG_CONTROL_PLANE:-}"
CHILLRIG_CONTROL_PLANE="${CHILLRIG_CONTROL_PLANE%/}"
CHILLRIG_ACME_EMAIL="${CHILLRIG_ACME_EMAIL:-}"
CHILLRIG_READY_URL="${CHILLRIG_READY_URL:-}"
CHILLRIG_READY_TOKEN="${CHILLRIG_READY_TOKEN:-}"
CHILLRIG_SLUG="${CHILLRIG_SLUG:-}"
CHILLRIG_CLOSE_SSH="${CHILLRIG_CLOSE_SSH:-}"
TTYD_VERSION="1.7.7"

if [[ -n "$CHILLRIG_CONTROL_PLANE" && "$CHILLRIG_CONTROL_PLANE" != https://* ]]; then
  echo "CHILLRIG_CONTROL_PLANE must start with https://" >&2
  exit 1
fi
if [[ -n "$CHILLRIG_CONTROL_PLANE" && -z "$CHILLRIG_DOMAIN" && "${CHILLRIG_SSLIP:-}" != "1" ]]; then
  echo "CHILLRIG_DOMAIN is required for a managed box." >&2
  exit 1
fi
if [[ -z "$CHILLRIG_ACME_EMAIL" && -n "$CHILLRIG_DOMAIN" ]]; then
  CHILLRIG_ACME_EMAIL="admin@${CHILLRIG_DOMAIN}"
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git tmux ufw jq python3 unzip xz-utils

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io
fi
systemctl enable --now docker

if ! command -v gh >/dev/null 2>&1; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y gh
fi

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

if ! /usr/local/bin/ttyd --version 2>/dev/null | grep -q "$TTYD_VERSION"; then
  case "$(uname -m)" in
    x86_64) TTYD_ASSET="ttyd.x86_64" ;;
    aarch64|arm64) TTYD_ASSET="ttyd.aarch64" ;;
    *) echo "Unsupported architecture." >&2; exit 1 ;;
  esac
  curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/${TTYD_ASSET}"
  chmod 0755 /usr/local/bin/ttyd
fi

if ! id "$CHILLRIG_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$CHILLRIG_USER"
fi
usermod -aG docker "$CHILLRIG_USER"
install -d -o "$CHILLRIG_USER" -g "$CHILLRIG_USER" -m 0755 "/home/${CHILLRIG_USER}/projects"
install -d -m 0755 /opt/chillrig /etc/chillrig /var/lib/chillrig

npm install -g @anthropic-ai/claude-code @openai/codex

if [[ -n "$CHILLRIG_SLUG" ]]; then
  hostnamectl set-hostname "$CHILLRIG_SLUG" || true
fi
printf '%s\n' "Chillrig" > /etc/motd
chmod -x /etc/update-motd.d/* 2>/dev/null || true

cat > "/home/${CHILLRIG_USER}/.tmux.conf" << 'EOF'
set -g history-limit 8000
set -g mouse on
set -g status off
set -g detach-on-destroy off
set -s exit-empty off
EOF
chown "${CHILLRIG_USER}:${CHILLRIG_USER}" "/home/${CHILLRIG_USER}/.tmux.conf"

# Agent, browser terminal and tmux service come from update.sh, the same script that
# updates a running box later, so a new box and an updated one end up identical.
# Managed boxes fetch it from the control plane; a checkout uses its own copy;
# otherwise it comes from GitHub.
CHILLRIG_ASSETS_URL="${CHILLRIG_ASSETS_URL:-}"
if [[ -z "$CHILLRIG_ASSETS_URL" && -n "$CHILLRIG_CONTROL_PLANE" ]]; then
  CHILLRIG_ASSETS_URL="${CHILLRIG_CONTROL_PLANE}/box"
fi
export CHILLRIG_USER CHILLRIG_CONTROL_PLANE CHILLRIG_ASSETS_URL CHILLRIG_UPDATE_NO_START=1
local_assets="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/public/box"
if [[ -f "${local_assets}/update.sh" && -f "${local_assets}/agent.mjs" ]]; then
  CHILLRIG_ASSETS_DIR="$local_assets" bash "${local_assets}/update.sh"
else
  assets="${CHILLRIG_ASSETS_URL:-https://raw.githubusercontent.com/zigcBenx/chillrig/main/public/box}"
  curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --max-time 60 -o /opt/chillrig/update.sh "${assets}/update.sh"
  bash /opt/chillrig/update.sh
fi
unset CHILLRIG_UPDATE_NO_START

# No Cloudflare zone: the VM names itself <ip-with-dashes>.sslip.io so Let's Encrypt
# can issue a certificate without any DNS records of our own.
if [[ "${CHILLRIG_SSLIP:-}" == "1" ]]; then
  public_ip=""
  if [[ -z "$public_ip" ]]; then
    public_ip=$(curl -fsS --max-time 3 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 2>/dev/null | tr -d '[:space:]' || true)
  fi
  if [[ ! "$public_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    public_ip=$(curl -4 -fsS --max-time 8 https://ipv4.icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)
  fi
  if [[ ! "$public_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "Could not detect a public IPv4 for sslip.io." >&2
    exit 1
  fi
  CHILLRIG_DOMAIN="${public_ip//./-}.sslip.io"
  echo "Using hostname ${CHILLRIG_DOMAIN}"
fi
if [[ -z "${CHILLRIG_ACME_EMAIL:-}" && -n "${CHILLRIG_DOMAIN:-}" ]]; then
  CHILLRIG_ACME_EMAIL="admin@${CHILLRIG_DOMAIN}"
fi

# The bcrypt hash contains '$'. Write it from Python so no shell heredoc can
# expand '$' or '$$'. Caddy 2 accepts the raw hash from `caddy hash-password`.
if [[ -n "$CHILLRIG_CONTROL_PLANE" ]]; then
  cat > /etc/chillrig/auth.caddy << EOF
forward_auth ${CHILLRIG_CONTROL_PLANE} {
	uri /api/terminal/verify
	header_up X-Chillrig-Ticket {http.request.uri.query.ticket}
	header_up X-Chillrig-Ticket-Header {http.request.header.X-Chillrig-Ticket}
	header_up X-Forwarded-Host {http.request.host}
	header_up X-Chillrig-Host {http.request.host}
}
EOF
else
  PASS_FILE=/etc/chillrig/terminal.password
  if [[ ! -s "$PASS_FILE" ]]; then
    openssl rand -base64 18 | tr -d '\n' > "$PASS_FILE"
    chmod 0600 "$PASS_FILE"
    echo "Terminal user: ${CHILLRIG_USER}"
    echo "Terminal password: $(cat "$PASS_FILE")"
  fi
  CHILLRIG_BASIC_USER="$CHILLRIG_USER" \
  CHILLRIG_BASIC_HASH="$(caddy hash-password --plaintext "$(tr -d '\n' < "$PASS_FILE")")" \
  python3 - << 'PY'
import os
from pathlib import Path
user = os.environ["CHILLRIG_BASIC_USER"]
hashed = os.environ["CHILLRIG_BASIC_HASH"].strip()
Path("/etc/chillrig/auth.caddy").write_text(f"basic_auth {{\n\t{user} {hashed}\n}}\n")
PY
fi
chmod 0644 /etc/chillrig/auth.caddy

# Shared site body. Boot on :80 so a missing DNS record cannot stop the box.
# When a domain is set, chillrig-tls swaps in the HTTPS file after the name resolves.
# __APP_PORT__ stays in the template the agent rewrites; it is not hidden in an import.
# The app preview imports preview.caddy (update.sh writes it, private by default): the
# agent checks the preview cookie on localhost, or the file is a comment when public.
# While nothing answers on the app port, the agent shows a calm "starting" page.
routes_body=$(cat << 'EOF'
	encode zstd gzip

	handle /_chillrig/health {
		reverse_proxy 127.0.0.1:7682
	}

	handle /_chillrig/* {
		import /etc/chillrig/auth.caddy
		reverse_proxy 127.0.0.1:7682 {
			header_up X-Chillrig-Auth "ok"
		}
	}

	handle /ttyd/* {
		import /etc/chillrig/auth.caddy
		reverse_proxy 127.0.0.1:7681 {
			header_up X-Chillrig-Auth "ok"
		}
	}

	handle {
		import /etc/chillrig/preview.caddy
		reverse_proxy 127.0.0.1:__APP_PORT__
	}

	handle_errors 502 503 504 {
		@preview not path /_chillrig/* /ttyd/*
		handle @preview {
			rewrite * /_chillrig/preview/waiting
			reverse_proxy 127.0.0.1:7682
		}
	}
EOF
)

cat > /etc/chillrig/Caddyfile.http.tmpl << EOF
:80 {
${routes_body}
}
EOF

if [[ -n "$CHILLRIG_DOMAIN" ]]; then
  cat > /etc/chillrig/Caddyfile.https.tmpl << EOF
{
	email ${CHILLRIG_ACME_EMAIL}
}

${CHILLRIG_DOMAIN} {
${routes_body}
}
EOF
  cat > /opt/chillrig/enable-tls.sh << EOF
#!/bin/bash
set -euo pipefail
domain=${CHILLRIG_DOMAIN}
while true; do
  if getent ahostsv4 "\$domain" >/dev/null 2>&1 || getent ahosts "\$domain" >/dev/null 2>&1; then
    port=\$(tr -d '[:space:]' < /etc/chillrig/app_port)
    sed "s/__APP_PORT__/\${port}/g" /etc/chillrig/Caddyfile.https.tmpl > /etc/caddy/Caddyfile.next
    if caddy validate --config /etc/caddy/Caddyfile.next >/dev/null 2>&1; then
      mv /etc/caddy/Caddyfile.next /etc/caddy/Caddyfile
      cp /etc/chillrig/Caddyfile.https.tmpl /etc/chillrig/Caddyfile.tmpl
      if caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || systemctl restart caddy; then
        exit 0
      fi
    fi
    rm -f /etc/caddy/Caddyfile.next
  fi
  sleep 15
done
EOF
  chmod 0755 /opt/chillrig/enable-tls.sh
  cat > /etc/systemd/system/chillrig-tls.service << 'EOF'
[Unit]
Description=Chillrig TLS once DNS resolves
After=caddy.service network-online.target
Wants=caddy.service

[Service]
Type=simple
ExecStart=/opt/chillrig/enable-tls.sh
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF
fi

cp /etc/chillrig/Caddyfile.http.tmpl /etc/chillrig/Caddyfile.tmpl
sed "s/__APP_PORT__/${CHILLRIG_APP_PORT}/g" /etc/chillrig/Caddyfile.tmpl > /etc/caddy/Caddyfile
printf '%s\n' "$CHILLRIG_APP_PORT" > /etc/chillrig/app_port
caddy validate --config /etc/caddy/Caddyfile

if [[ "$CHILLRIG_CLOSE_SSH" == "1" ]]; then
  install -d /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/99-chillrig.conf << 'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

# Allow SSH before the default deny and before the firewall is enabled.
# Enabling it otherwise resets the current SSH session (client exit 255) even
# though the rest of the script keeps running.
ufw allow 22/tcp
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
if [[ -n "${SSH_CONNECTION:-}" && -f "$0" ]]; then
  echo "Enabling the firewall in the background so this SSH session is not reset."
  echo "Log: /var/log/chillrig-install.log"
  export CHILLRIG_USER CHILLRIG_DOMAIN CHILLRIG_CONTROL_PLANE CHILLRIG_CLOSE_SSH
  export CHILLRIG_APP_PORT CHILLRIG_READY_URL CHILLRIG_READY_TOKEN CHILLRIG_SLUG CHILLRIG_ACME_EMAIL
  {
    echo "#!/bin/bash"
    echo "set -euo pipefail"
    echo "unset SSH_CONNECTION"
    echo "sleep 2"
    sed -n '/^# --- finish-firewall ---$/,$p' "$0"
  } > /opt/chillrig/finish-install.sh
  chmod 0755 /opt/chillrig/finish-install.sh
  setsid nohup /opt/chillrig/finish-install.sh >> /var/log/chillrig-install.log 2>&1 < /dev/null &
  exit 0
fi
# --- finish-firewall ---
# Accept the session that is already open, then enable. ufw's reload can drop it
# for a moment; the rule is inserted again immediately after enable.
keep_established() {
  iptables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT || true
  ip6tables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    ip6tables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT || true
}
keep_established
ufw --force enable
keep_established
if [[ "$CHILLRIG_CLOSE_SSH" == "1" && -z "${SSH_CONNECTION:-}" ]]; then
  # Delete every SSH allow, including "22/tcp" and "OpenSSH", highest number first.
  while true; do
    # grep exits 1 once no SSH rule is left; with pipefail that would abort the install.
    num=$(ufw status numbered | grep ALLOW | grep -E 'OpenSSH|22/tcp' | sed -n 's/^\[\s*\([0-9][0-9]*\)\].*/\1/p' | tail -1 || true)
    [[ -n "${num}" ]] || break
    ufw --force delete "$num" >/dev/null 2>&1 || break
  done
fi

systemctl daemon-reload
systemctl enable chillrig-tmux chillrig-agent chillrig-ttyd caddy
# Start, never restart, tmux: restarting would not end sessions, but there is no need.
systemctl start chillrig-tmux
systemctl restart chillrig-agent chillrig-ttyd caddy
if [[ -n "$CHILLRIG_DOMAIN" ]]; then
  systemctl enable --now chillrig-tls.service
fi
touch /var/lib/chillrig/ready

if [[ -n "$CHILLRIG_READY_URL" && -n "$CHILLRIG_READY_TOKEN" ]]; then
  curl -fsS --retry 5 --retry-delay 3 -X POST "$CHILLRIG_READY_URL" \
    -H "Authorization: Bearer ${CHILLRIG_READY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"ok":true}' || echo "Ready callback did not reach the control plane."
fi

# Drop cloud-init copies of the ready token and control-plane URL.
shopt -s nullglob
for path in \
  /var/lib/cloud/instance/user-data.txt \
  /var/lib/cloud/instance/user-data.txt.i \
  /var/lib/cloud/instance/vendor-data.txt \
  /var/lib/cloud/instance/vendor-data.txt.i \
  /var/lib/cloud/instances/*/user-data.txt \
  /var/lib/cloud/instances/*/user-data.txt.i \
  /var/lib/cloud/instances/*/vendor-data.txt \
  /var/lib/cloud/instances/*/cloud-config.txt
do
  [[ -f "$path" ]] || continue
  shred -u -n 1 "$path" 2>/dev/null || rm -f "$path"
done
shopt -u nullglob

echo "Chillrig box is ready."
