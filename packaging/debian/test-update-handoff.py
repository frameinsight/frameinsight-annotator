"""Exercise the installed frozen updater and real apt in a disposable container.

Only GUI authorization is substituted: this script runs as container root.
The package, preinst/prerm guards, helper, staged bytes and install are real.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

if os.environ.get('FRAMEINSIGHT_DISPOSABLE_TEST') != '1' or os.getuid() != 0:
    raise SystemExit('Run only as root inside the disposable package-test container')
package = Path(sys.argv[1]).resolve()
report = Path('/tmp/frameinsight-debian-runtime.json')
before = json.loads(report.read_text())
private = Path(tempfile.mkdtemp(prefix='frameinsight-private-update-'))
source = private / package.name
shutil.copyfile(package, source)
source.chmod(0o600)
# A PackageKit/_apt-style unprivileged reader cannot access the old location.
blocked = subprocess.run(['runuser','-u','nobody','--','head','-c','1',str(source)], capture_output=True)
assert blocked.returncode != 0
bin_dir = private / 'bin'; bin_dir.mkdir()
installer = bin_dir / 'gdebi-gtk'
installer.write_text('''#!/bin/sh
set -eu
# No frozen Frameinsight process may remain, including the update helper.
/bin/sh /src/packaging/debian/maintainer-check.sh
runuser -u nobody -- head -c 1 "$1" >/dev/null
printf 'STAGED_PACKAGE=%s\\n' "$1"
apt-get install -y --reinstall --no-install-recommends "$1"
''')
installer.chmod(0o755)
env = dict(os.environ, PATH=str(bin_dir)+':'+os.environ['PATH'])
completed = subprocess.run(['/opt/frameinsight/Frameinsight','--update-helper','--package',str(source),
    '--sha256',hashlib.sha256(source.read_bytes()).hexdigest(),'--size',str(source.stat().st_size),
    '--server','2147483647','--platform','debian','--installer','gdebi-gtk'],env=env,capture_output=True,timeout=180)
log = (private/'install-handoff.log').read_text()
print(log, flush=True)
assert completed.returncode == 0, completed.stderr.decode()
assert 'Installer process exit code: 0' in log and 'Setting up frameinsight' in log
assert hashlib.sha256(Path(before['database']).read_bytes()).hexdigest() == before['database_sha256']
status = subprocess.check_output(['dpkg-query','-W','-f=${Status}','frameinsight'],text=True)
assert status == 'install ok installed'
staged = next(line.split('=',1)[1] for line in log.splitlines() if line.startswith('STAGED_PACKAGE='))
shutil.rmtree(Path(staged).parent)
# Substitute only system authorization inside this disposable root container.
# The frozen helper, apt installation, version verification and restart are real.
pkexec = bin_dir / 'pkexec'
pkexec.write_text('''#!/bin/sh
set -eu
/bin/sh /src/packaging/debian/maintainer-check.sh
for arg do
  case "$arg" in *.deb) runuser -u nobody -- head -c 1 "$arg" >/dev/null; printf 'STAGED_PACKAGE=%s\\n' "$arg";; esac
done
exec "$@"
''')
pkexec.chmod(0o755)
restart = private / 'restart.sh'
restart.write_text('''#!/bin/sh
set -eu
runuser -u annotator -- env FRAMEINSIGHT_DISABLE_AUTO_UPDATE=1 XDG_DATA_HOME=/tmp/frameinsight-test-data XDG_STATE_HOME=/tmp/frameinsight-test-state /opt/frameinsight/Frameinsight --no-browser
''')
restart.chmod(0o755)
completed = subprocess.run(['/opt/frameinsight/Frameinsight','--update-helper','--package',str(source),
    '--sha256',hashlib.sha256(source.read_bytes()).hexdigest(),'--size',str(source.stat().st_size),
    '--server','2147483647','--platform','debian','--installer','pkexec','--automatic',
    '--version',before['app_version'],'--restart',str(restart)],env=env,capture_output=True,timeout=180)
assert completed.returncode == 0, completed.stderr.decode()
log = (private/'install-handoff.log').read_text()
assert 'Update installed. Reopening Frameinsight.' in log, log
for _ in range(200):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/openapi.json',timeout=2) as response:
            assert json.load(response)['info']['version'] == before['app_version']
        break
    except OSError: time.sleep(.2)
else: raise AssertionError('Automatic update did not reopen the installed app')
subprocess.run(['runuser','-u','annotator','--','env','XDG_DATA_HOME=/tmp/frameinsight-test-data',
               'XDG_STATE_HOME=/tmp/frameinsight-test-state','/opt/frameinsight/Frameinsight','--stop','--yes'],check=True,timeout=30)
assert hashlib.sha256(Path(before['database']).read_bytes()).hexdigest() == before['database_sha256']
staged = next(line.split('=',1)[1] for line in log.splitlines() if line.startswith('STAGED_PACKAGE='))
shutil.rmtree(Path(staged).parent)
shutil.rmtree(private)
before['checks'] += ['frozen Debian update handoff exits runtime before real apt reinstall',
    'verified update staged outside private data and readable by package-manager user',
    'updater reinstall captures installer output and preserves database bytes',
    'automatic Debian update runs apt after the frozen helper exits',
    'automatic Debian update verifies installed version and reopens the app',
    'automatic update preserves database bytes']
updated = report.with_suffix('.updated.json')
updated.write_text(json.dumps(before,indent=2)+'\n')
updated.replace(report)
