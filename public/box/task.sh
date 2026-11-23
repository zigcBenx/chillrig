#!/bin/bash
# Runs one Chillrig task inside its tmux session (the agent starts it with argv, no shell):
#   task.sh <session> <claude|codex> [tool flags...]
# The prompt comes from ~/.chillrig/tasks/<session>.prompt and is passed to the tool as
# one argument after "--", never through a shell string. When the tool exits, the exit
# code is saved on the session (@cr_exit) and a shell opens in the project, so the
# output stays readable and the user can carry on.
set -u
name="${1:-}"
tool="${2:-}"
shift 2 2>/dev/null || true

if [[ ! "$name" =~ ^[a-zA-Z0-9_-]{1,64}$ ]] || [[ "$tool" != "claude" && "$tool" != "codex" ]]; then
  echo "Chillrig: this task could not start."
  exec bash -l
fi

file="${HOME}/.chillrig/tasks/${name}.prompt"
prompt=""
if [[ -f "$file" && ! -L "$file" ]]; then
  prompt="$(cat -- "$file")"
  rm -f -- "$file"
fi

if [[ -n "$prompt" ]]; then
  "$tool" "$@" -- "$prompt"
else
  "$tool" "$@"
fi
code=$?
tmux set-option -q @cr_exit "$code" 2>/dev/null || true
printf '\n\033[2m%s finished. You are in %s. Type %s to start it again.\033[0m\n' "$tool" "$PWD" "$tool"
exec bash -l
