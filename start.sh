#!/usr/bin/env bash
# Cross-platform start script for kiro-proxy (OpenAI format)
# Works on Linux and macOS
set -euo pipefail
cd "$(dirname "$0")"
export KIRO_PROXY_PORT="${KIRO_PROXY_PORT:-11436}"
exec node index.js
