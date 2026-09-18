#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
if systemctl --user is-active --quiet frameinsight.service; then
  echo 'Frameinsight is already running: http://127.0.0.1:8765'
  exit 0
fi
if [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/frameinsight.service" ]]; then
  systemctl --user start frameinsight.service
else
  systemd-run --user --unit=frameinsight --description='Frameinsight local video annotator' --property="WorkingDirectory=$project_dir" "$project_dir/scripts/start.sh"
fi
echo 'Open http://127.0.0.1:8765'
