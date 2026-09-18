#!/usr/bin/env bash
# Install the local backend as a login service. Existing annotations are untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
if systemctl --user is-active --quiet frameinsight.service; then
  echo 'Stop Frameinsight after its current jobs finish, then run this installer.' >&2
  exit 1
fi
.venv/bin/python - <<'PY'
from pathlib import Path
import os
root = Path.cwd()
def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
unit = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'systemd/user/frameinsight.service'
unit.parent.mkdir(parents=True, exist_ok=True)
unit.write_text(f'''[Unit]
Description=Frameinsight local video annotator
After=network.target

[Service]
Type=simple
WorkingDirectory={quote(root)}
ExecStart={quote(root / 'scripts/start.sh')}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
''')
PY
systemctl --user daemon-reload
systemctl --user enable --now frameinsight.service
echo 'Frameinsight will start at login. Open http://127.0.0.1:8765'
