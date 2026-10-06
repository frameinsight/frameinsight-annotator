"""Detached, standard-library-only installer handoff after the app has stopped.

Run by updates.py for a verified startup update or an explicit Install action. The Windows launcher
mutex must be released before NSIS starts. Debian installers request their own
administrator authorization; Frameinsight never collects a password.
"""
import argparse
import base64
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def linux_process_alive(pid, starts):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        # A zombie has already released executable files and cannot be shut
        # down further. Container PID 1 may defer reaping it indefinitely.
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] in ('Z', 'X'):
            return False
        started = fields[19]
        return started == starts.setdefault(pid, started)
    except FileNotFoundError:
        return False
    except (OSError, ValueError, IndexError):
        # Without readable proc metadata, retain the conservative kill(0) check.
        return True


def wait_for_exit(process_ids, timeout=120):
    deadline = time.monotonic() + timeout
    if sys.platform == 'win32':
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handles = [kernel.OpenProcess(0x100000, False, pid) for pid in process_ids]
        try:
            while time.monotonic() < deadline:
                if all(not handle or kernel.WaitForSingleObject(handle, 0) == 0 for handle in handles):
                    return
                time.sleep(.2)
        finally:
            for handle in handles:
                if handle:
                    kernel.CloseHandle(handle)
    else:
        starts = {}
        while time.monotonic() < deadline:
            if not any(linux_process_alive(pid, starts) for pid in process_ids):
                return
            time.sleep(.2)
    raise TimeoutError('Frameinsight did not close within two minutes. Close it before installing the downloaded package.')


def installer_command(kind, package, installer=None, automatic=False):
    if kind == 'windows':
        return [str(package), '/S'] if automatic else [str(package)]
    if automatic:
        if installer != 'pkexec' or not shutil.which('pkexec') or not shutil.which('apt-get'):
            raise ValueError('Automatic Debian updates require the system authorization service and apt-get')
        return [shutil.which('pkexec'), shutil.which('apt-get'), 'install', '--yes', '--no-install-recommends', str(package)]
    if installer not in ('gdebi-gtk', 'qapt-deb-installer', 'gnome-software'):
        raise ValueError('Unsupported system package installer')
    executable = shutil.which(installer)
    if not executable:
        raise ValueError('The system package installer is no longer available')
    return [executable, f'--local-filename={package}'] if installer == 'gnome-software' else [executable, str(package)]


def system_environment():
    environment = dict(os.environ)
    if 'LD_LIBRARY_PATH_ORIG' in environment:
        environment['LD_LIBRARY_PATH'] = environment.pop('LD_LIBRARY_PATH_ORIG')
    else:
        environment.pop('LD_LIBRARY_PATH', None)
    return environment


def stage_debian_package(package, size, checksum):
    """PackageKit/_apt cannot traverse the private annotation data directory.

    Stage only the public release installer, never project data. The unique
    directory is not writable by other users; verify the copied bytes before
    making them readable by the system package manager.
    """
    directory = Path(tempfile.mkdtemp(prefix='frameinsight-update-', dir='/tmp'))
    try:
        target = directory / package.name
        digest, copied = hashlib.sha256(), 0
        with package.open('rb') as source, target.open('xb') as destination:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                copied += len(chunk)
                if copied > size:
                    raise ValueError('Downloaded package changed while preparing installation')
                digest.update(chunk)
                destination.write(chunk)
        if copied != size or digest.hexdigest() != checksum:
            raise ValueError('Downloaded package changed while preparing installation')
        target.chmod(0o644)
        directory.chmod(0o755)
        return target
    except Exception:
        shutil.rmtree(directory)
        raise


# Replace the frozen helper with a system shell before starting the installer.
# A waiting frozen helper would itself trigger the package's running-app guard.
# Arguments are passed separately, never interpolated into shell program text.
DEBIAN_HANDOFF = r'''
log=$1
package=$2
shift 2
cd / || exit 1
printf '%s\n' 'Opening verified installer. Its output follows.' >> "$log"
"$@" >> "$log" 2>&1
result=$?
printf '\nInstaller process exit code: %s\n' "$result" >> "$log"
if [ "$result" -ne 0 ]; then
    message="The system installer did not complete (exit $result). Your annotations are unchanged. Close Frameinsight and open the verified package manually: $package

Details: $log"
    if command -v zenity >/dev/null 2>&1; then
        zenity --error --title='Frameinsight update' --text="$message" --width=520 >> "$log" 2>&1
    fi
else
    printf '%s\n' 'Installer closed. Reopen Frameinsight to check the installed version. Closing or cancelling the installer does not confirm an update.' >> "$log"
fi
exit "$result"
'''

DEBIAN_AUTOMATIC_HANDOFF = r'''
log=$1
package=$2
expected=$3
restart=$4
shift 4
cd / || exit 1
printf '%s\n' 'Installing verified update. The system may ask for administrator authorization.' >> "$log"
"$@" >> "$log" 2>&1
result=$?
if [ "$result" -eq 0 ]; then
    installed=$(dpkg-query -W '-f=${Version}' frameinsight 2>> "$log")
    if [ "$installed" != "$expected" ]; then result=1; fi
fi
printf '\nInstaller process exit code: %s\n' "$result" >> "$log"
if [ "$result" -eq 0 ]; then
    printf '%s\n' 'Update installed. Reopening Frameinsight.' >> "$log"
    "$restart" >> "$log" 2>&1 &
else
    message="Frameinsight could not finish updating. Your annotations are unchanged. You can reopen the app and keep working.

Details: $log"
    if command -v zenity >/dev/null 2>&1; then
        zenity --error --title='Frameinsight update' --text="$message" --width=520 >> "$log" 2>&1
    fi
fi
exit "$result"
'''

# This system process outlives the bundled Python helper. Waiting for the helper
# to exit releases Python/DLL locks before a silent installer replaces the app.
# All variable values travel through the environment, never script interpolation.
WINDOWS_AUTOMATIC_HANDOFF = r'''
$ErrorActionPreference = 'Stop'
$log = $env:FRAMEINSIGHT_UPDATE_LOG
try {
    Wait-Process -Id ([int]$env:FRAMEINSIGHT_UPDATE_HELPER) -Timeout 120 -ErrorAction SilentlyContinue
    if (Get-Process -Id ([int]$env:FRAMEINSIGHT_UPDATE_HELPER) -ErrorAction SilentlyContinue) { throw 'Update helper did not exit.' }
    $package = $env:FRAMEINSIGHT_UPDATE_PACKAGE
    if ((Get-Item -LiteralPath $package).Length -ne [long]$env:FRAMEINSIGHT_UPDATE_SIZE) { throw 'Installer size changed.' }
    if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $env:FRAMEINSIGHT_UPDATE_SHA256) { throw 'Installer checksum changed.' }
    $installer = Start-Process -FilePath $package -ArgumentList '/S' -PassThru -Wait
    if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)." }
    $restart = $env:FRAMEINSIGHT_UPDATE_RESTART
    $manifest = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $restart) 'build-manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne $env:FRAMEINSIGHT_UPDATE_VERSION) { throw 'Installed version does not match the verified update.' }
    Add-Content -LiteralPath $log -Value 'Update installed. Reopening Frameinsight.'
    Start-Process -FilePath $restart
    exit 0
} catch {
    $message = "Frameinsight could not finish updating. Your annotations are unchanged. You can reopen the app and keep working.`n`n$($_.Exception.Message)`nDetails: $log"
    Add-Content -LiteralPath $log -Value $message
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, 'Frameinsight update') | Out-Null
    exit 1
}
'''


def launch_windows_automatic(package, size, checksum, version, restart, log):
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    environment = system_environment()
    environment.update(FRAMEINSIGHT_UPDATE_HELPER=str(os.getpid()), FRAMEINSIGHT_UPDATE_LOG=str(log),
                       FRAMEINSIGHT_UPDATE_PACKAGE=str(package), FRAMEINSIGHT_UPDATE_SIZE=str(size),
                       FRAMEINSIGHT_UPDATE_SHA256=checksum, FRAMEINSIGHT_UPDATE_VERSION=version,
                       FRAMEINSIGHT_UPDATE_RESTART=str(restart))
    encoded = base64.b64encode(WINDOWS_AUTOMATIC_HANDOFF.encode('utf-16-le')).decode('ascii')
    log.write_text('Verified automatic update prepared. Waiting for the app runtime to exit.\n', encoding='utf-8')
    subprocess.Popen([str(powershell), '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     cwd=str(package.parent), env=environment,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)


def launch_debian(package, size, checksum, installer, log, automatic=False, version=None, restart=None):
    # Resolve the system installer before creating the staged copy.
    installer_command('debian', package, installer, automatic)
    staged = stage_debian_package(package, size, checksum)
    command = installer_command('debian', staged, installer, automatic)
    log.write_text('Verified Debian update prepared. Project data stays private.\n', encoding='utf-8')
    # The system shell survives replacement of /opt/frameinsight and records
    # failures instead of throwing away the package manager's stdout/stderr.
    script = DEBIAN_AUTOMATIC_HANDOFF if automatic else DEBIAN_HANDOFF
    extra = [version, str(restart)] if automatic else []
    os.execve('/bin/sh', ['/bin/sh', '-c', script, 'frameinsight-update',
                         str(log), str(staged), *extra, *command], system_environment())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--size', required=True, type=int)
    parser.add_argument('--server', required=True, type=int)
    parser.add_argument('--launcher', type=int)
    parser.add_argument('--platform', required=True, choices=['windows', 'debian'])
    parser.add_argument('--installer')
    parser.add_argument('--automatic', action='store_true')
    parser.add_argument('--version')
    parser.add_argument('--restart', type=Path)
    args = parser.parse_args()
    log = args.package.parent / 'install-handoff.log'
    try:
        if args.automatic and (not args.version or not args.restart or not args.restart.is_file()):
            raise ValueError('Automatic update requires the installed launcher and target version')
        wait_for_exit([pid for pid in (args.server, args.launcher) if pid])
        if args.package.is_symlink() or not args.package.is_file() or args.package.stat().st_size != args.size:
            raise ValueError('The downloaded package changed before installation. Nothing was installed.')
        digest = hashlib.sha256()
        with args.package.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != args.sha256:
            raise ValueError('The downloaded package checksum changed. Nothing was installed.')
        if args.platform == 'debian':
            launch_debian(args.package, args.size, args.sha256, args.installer, log,
                          args.automatic, args.version, args.restart)
            return 0
        if args.automatic:
            launch_windows_automatic(args.package, args.size, args.sha256, args.version, args.restart, log)
            return 0
        subprocess.Popen(installer_command(args.platform, args.package, args.installer),
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=system_environment())
        log.write_text('Verified installer opened. Complete its prompts; then reopen Frameinsight.\n', encoding='utf-8')
        return 0
    except Exception as error:
        message = f'Frameinsight update could not start: {error}'
        log.write_text(message + '\n', encoding='utf-8')
        if sys.platform == 'win32':
            ctypes.windll.user32.MessageBoxW(None, message, 'Frameinsight update', 0x10)
        elif shutil.which('zenity'):
            subprocess.Popen(['zenity', '--error', '--title=Frameinsight update', f'--text={message}'], env=system_environment())
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
