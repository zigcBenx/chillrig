#!/bin/bash
# ttyd runs this for each browser terminal: attach to the shared tmux session.
# The tmux server itself belongs to chillrig-tmux.service, so it outlives ttyd.
set -euo pipefail
cd "${HOME:-/}"
if ! /usr/bin/tmux has-session -t chillrig 2>/dev/null; then
  /usr/bin/tmux new-session -d -s chillrig -c "${HOME:-/}"
fi
exec /usr/bin/tmux attach -t chillrig
