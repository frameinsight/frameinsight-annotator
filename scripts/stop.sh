#!/usr/bin/env bash
set -euo pipefail
# Stop only the systemd unit created by start-background.sh; foreground runs use Ctrl+C.
systemctl --user stop frameinsight.service
