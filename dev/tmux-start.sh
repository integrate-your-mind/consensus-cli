#!/usr/bin/env bash
set -euo pipefail

SCOUT_DIR="$(pwd -P)"

if tmux has-session -t scout 2>/dev/null; then
  tmux set-environment -g SCOUT_DIR "$SCOUT_DIR"
  tmux set-environment -g PATH "$PATH"
  tmux set-environment -t scout SCOUT_DIR "$SCOUT_DIR"
  tmux set-environment -t scout PATH "$PATH"
  exec tmux -f ./dev/tmux.conf attach -t scout
fi

exec env SCOUT_DIR="$SCOUT_DIR" PATH="$PATH" tmux -f ./dev/tmux.conf new -s scout
