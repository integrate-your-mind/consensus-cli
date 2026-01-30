#!/usr/bin/env bash
set -euo pipefail

SCOUT_DIR="$(pwd -P)"
exec env SCOUT_DIR="$SCOUT_DIR" tmux -f ./dev/tmux.conf new -A -s scout
