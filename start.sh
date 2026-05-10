#!/usr/bin/env bash
# kiro-proxy start script — Linux / macOS
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --omit=dev
export KIRO_PROXY_PORT="${KIRO_PROXY_PORT:-11436}"
exec node index.js
