#!/bin/bash
# Chillrig box bootstrap for Ubuntu 24.04.
# Managed boxes are started from the control plane with env vars already exported.
# Self-host: sudo CHILLRIG_DOMAIN=box.example.com bash install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

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
if [[ -n "$CHILLRIG_CONTROL_PLANE" && -z "$CHILLRIG_DOMAIN" ]]; then
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
EOF
chown "${CHILLRIG_USER}:${CHILLRIG_USER}" "/home/${CHILLRIG_USER}/.tmux.conf"

cat > /opt/chillrig/attach.sh << EOF
#!/bin/bash
set -euo pipefail
export HOME=/home/${CHILLRIG_USER}
cd "\$HOME"
/usr/bin/tmux start-server
if ! /usr/bin/tmux has-session -t chillrig 2>/dev/null; then
  /usr/bin/tmux new-session -d -s chillrig -c "\$HOME"
fi
exec /usr/bin/tmux attach -t chillrig
EOF
chmod 0755 /opt/chillrig/attach.sh

cat > /opt/chillrig/agent.mjs << 'EOF'
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const user = process.env.CHILLRIG_USER || "coder";
const home = `/home/${user}`;

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8000) reject(new Error("too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("json"));
      }
    });
  });
}

function parseRepo(input) {
  if (typeof input !== "string" || input.length > 200 || /\s/.test(input)) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search) return null;
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo || owner.startsWith(".") || repo.startsWith(".")) return null;
  return { cloneUrl: `https://github.com/${owner}/${repo}.git`, repo };
}

function isPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535 && value !== 7681 && value !== 7682;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs || 120000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("command failed"));
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const route = url.pathname.replace(/^\/_chillrig/, "") || "/";
    if (req.method === "GET" && route === "/health") {
      const ready = existsSync("/var/lib/chillrig/ready");
      return send(res, ready ? 200 : 503, { ok: ready });
    }
    if (req.method === "POST" && route === "/clone") {
      const body = await readJson(req);
      const repo = parseRepo(body.url);
      if (!repo) return send(res, 400, { error: "Invalid GitHub URL" });
      const dest = `${home}/projects/${repo.repo}`;
      if (existsSync(dest)) return send(res, 409, { error: "Already cloned" });
      await run("runuser", ["-u", user, "--", "git", "clone", "--depth", "1", repo.cloneUrl, dest], {
        env: { HOME: home, USER: user, LOGNAME: user, PATH: process.env.PATH, GIT_TERMINAL_PROMPT: "0" },
      });
      return send(res, 200, { ok: true, path: `~/projects/${repo.repo}` });
    }
    if (req.method === "POST" && route === "/port") {
      const body = await readJson(req);
      const port = Number(body.port);
      if (!isPort(port)) return send(res, 400, { error: "Invalid port" });
      const template = readFileSync("/etc/chillrig/Caddyfile.tmpl", "utf8");
      writeFileSync("/etc/caddy/Caddyfile", template.replaceAll("__APP_PORT__", String(port)));
      writeFileSync("/etc/chillrig/app_port", String(port));
      await run("caddy", ["reload", "--config", "/etc/caddy/Caddyfile"], { timeoutMs: 20000 });
      return send(res, 200, { ok: true, port });
    }
    return send(res, 404, { error: "Not found" });
  } catch {
    if (!res.headersSent) send(res, 500, { error: "Failed" });
  }
});

server.listen(7682, "127.0.0.1");
EOF

cat > /etc/chillrig/env << EOF
CHILLRIG_USER=${CHILLRIG_USER}
EOF
chmod 0644 /etc/chillrig/env

AUTH_BLOCK=""
if [[ -n "$CHILLRIG_CONTROL_PLANE" ]]; then
  AUTH_BLOCK=$(cat << EOF
forward_auth ${CHILLRIG_CONTROL_PLANE} {
	uri /api/terminal/verify
	header_up X-Chillrig-Ticket {http.request.uri.query.ticket}
	header_up X-Chillrig-Ticket-Header {http.request.header.X-Chillrig-Ticket}
	header_up X-Forwarded-Host {http.request.host}
}
EOF
)
else
  PASS_FILE=/etc/chillrig/terminal.password
  if [[ ! -s "$PASS_FILE" ]]; then
    openssl rand -base64 18 > "$PASS_FILE"
    chmod 0600 "$PASS_FILE"
    echo "Terminal user: ${CHILLRIG_USER}"
    echo "Terminal password: $(cat "$PASS_FILE")"
  fi
  HASH=$(caddy hash-password --plaintext "$(cat "$PASS_FILE")" | sed 's/\$/\$\$/g')
  AUTH_BLOCK=$(cat << EOF
basic_auth {
	${CHILLRIG_USER} ${HASH}
}
EOF
)
fi

SITE_ADDRESS="${CHILLRIG_DOMAIN:-:80}"
GLOBAL_BLOCK=""
if [[ -n "$CHILLRIG_DOMAIN" ]]; then
  GLOBAL_BLOCK=$(cat << EOF
{
	email ${CHILLRIG_ACME_EMAIL}
}
EOF
)
fi

cat > /etc/chillrig/Caddyfile.tmpl << EOF
${GLOBAL_BLOCK}

${SITE_ADDRESS} {
	encode zstd gzip

	handle /_chillrig/health {
		reverse_proxy 127.0.0.1:7682
	}

	handle /_chillrig/* {
		${AUTH_BLOCK}
		reverse_proxy 127.0.0.1:7682 {
			header_up X-Chillrig-Auth "ok"
		}
	}

	handle /ttyd/* {
		${AUTH_BLOCK}
		reverse_proxy 127.0.0.1:7681 {
			header_up X-Chillrig-Auth "ok"
		}
	}

	handle {
		reverse_proxy 127.0.0.1:__APP_PORT__
	}
}
EOF

sed "s/__APP_PORT__/${CHILLRIG_APP_PORT}/g" /etc/chillrig/Caddyfile.tmpl > /etc/caddy/Caddyfile
printf '%s\n' "$CHILLRIG_APP_PORT" > /etc/chillrig/app_port
caddy validate --config /etc/caddy/Caddyfile

cat > /etc/systemd/system/chillrig-agent.service << EOF
[Unit]
Description=Chillrig box agent
After=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/chillrig/env
ExecStart=/usr/bin/node /opt/chillrig/agent.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/chillrig-ttyd.service << EOF
[Unit]
Description=Chillrig terminal
After=network-online.target

[Service]
Type=simple
User=${CHILLRIG_USER}
Group=${CHILLRIG_USER}
WorkingDirectory=/home/${CHILLRIG_USER}
Environment=HOME=/home/${CHILLRIG_USER}
ExecStart=/usr/local/bin/ttyd -W -i 127.0.0.1 -p 7681 -b /ttyd -m 4 -H X-Chillrig-Auth /opt/chillrig/attach.sh
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

if [[ "$CHILLRIG_CLOSE_SSH" == "1" ]]; then
  install -d /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/99-chillrig.conf << 'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
if [[ "$CHILLRIG_CLOSE_SSH" == "1" ]]; then
  ufw delete allow OpenSSH >/dev/null 2>&1 || true
else
  ufw allow OpenSSH
fi
ufw --force enable

systemctl daemon-reload
systemctl enable chillrig-agent chillrig-ttyd caddy
systemctl restart chillrig-agent chillrig-ttyd caddy
touch /var/lib/chillrig/ready

if [[ -n "$CHILLRIG_READY_URL" && -n "$CHILLRIG_READY_TOKEN" ]]; then
  curl -fsS --retry 5 --retry-delay 3 -X POST "$CHILLRIG_READY_URL" \
    -H "Authorization: Bearer ${CHILLRIG_READY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"ok":true}' || echo "Ready callback did not reach the control plane."
fi

echo "Chillrig box is ready."
