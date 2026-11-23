#!/bin/bash
# ttyd runs this for each browser terminal. ttyd -a passes ?arg=<session> from the
# WebSocket URL as $1: attach to that task session when it exists, else to the shared
# "chillrig" session. The tmux server belongs to chillrig-tmux.service, so it outlives ttyd.
set -euo pipefail
cd "${HOME:-/}"
target="chillrig"
if [[ "${1:-}" =~ ^[a-zA-Z0-9_-]{1,64}$ ]] && /usr/bin/tmux has-session -t "=${1}" 2>/dev/null; then
  target="$1"
fi
if [[ "$target" == "chillrig" ]] && ! /usr/bin/tmux has-session -t =chillrig 2>/dev/null; then
  /usr/bin/tmux new-session -d -s chillrig -c "${HOME:-/}"
fi
exec /usr/bin/tmux attach -t "=${target}"
