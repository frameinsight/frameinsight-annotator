#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -r requirements.txt
(cd frontend && npm ci && npm run build)
echo 'Ready. Run ./scripts/start.sh and open http://127.0.0.1:8765'
echo 'Optional GPU dependencies are documented in docs/SETUP.md; manual editing needs no torch.'
