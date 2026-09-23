#!/bin/sh
set -eu
# Never replace or remove a runtime while an annotator is still using it.
for process in /proc/[0-9]*/exe; do
  executable=$(readlink "$process" 2>/dev/null || true)
  case "$executable" in
    /opt/frameinsight/Frameinsight|'/opt/frameinsight/Frameinsight (deleted)')
      echo 'Close Frameinsight from its application menu (or run frameinsight --stop), then retry. Saved projects will be kept.' >&2
      exit 1
      ;;
  esac
done
exit 0
