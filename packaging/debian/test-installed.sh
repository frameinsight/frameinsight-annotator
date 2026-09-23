#!/usr/bin/env bash
# Run only in a disposable Linux container/CI machine: installs and removes the package.
set -euo pipefail
if [[ "${FRAMEINSIGHT_DISPOSABLE_TEST:-}" != "1" ]]; then echo 'Set FRAMEINSIGHT_DISPOSABLE_TEST=1 inside a disposable test environment.' >&2; exit 1; fi
package=$1
apt-get update
apt-get install -y --no-install-recommends "$package"
id annotator >/dev/null 2>&1 || useradd -m annotator
python /src/packaging/make_smoke_fixture.py /tmp/frameinsight-numbered.mp4
runuser -u annotator -- env XDG_DATA_HOME=/tmp/frameinsight-test-data XDG_STATE_HOME=/tmp/frameinsight-test-state \
  python /src/packaging/debian/smoke.py --fixture /tmp/frameinsight-numbered.mp4 --report /tmp/frameinsight-debian-runtime.json
apt-get install -y --reinstall --no-install-recommends "$package"
python - <<'PY'
from pathlib import Path
import hashlib,json
r=json.loads(Path('/tmp/frameinsight-debian-runtime.json').read_text())
assert hashlib.sha256(Path(r['database']).read_bytes()).hexdigest()==r['database_sha256']
PY
apt-get purge -y frameinsight
python - <<'PY'
from pathlib import Path
import hashlib,json
r=json.loads(Path('/tmp/frameinsight-debian-runtime.json').read_text())
assert not Path('/opt/frameinsight/Frameinsight').exists()
assert hashlib.sha256(Path(r['database']).read_bytes()).hexdigest()==r['database_sha256']
r['checks'] += ['reinstall preserves database bytes', 'purge removes application', 'purge preserves user database bytes']
Path('/build/debian-smoke-report.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps(r))
PY
