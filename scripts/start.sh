#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -f frontend/dist/index.html ]]; then
  echo 'Run ./scripts/setup.sh first.' >&2
  exit 1
fi
mkdir -p .frameinsight
exec .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765 --no-access-log
