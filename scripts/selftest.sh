#!/usr/bin/env bash
# Runs the real app against the synthetic test lines and prints the report.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
out="$(pwd -W 2>/dev/null || pwd)/step-zero/proxy"
mkdir -p "$out"
rm -f "$out/selftest.json"
INKD_SELFTEST="$out" npx tauri dev --no-watch > /dev/null 2>&1 || true
python scripts/report.py "$out/selftest.json"
