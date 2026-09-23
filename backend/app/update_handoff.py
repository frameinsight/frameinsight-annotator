"""Detached, standard-library-only installer handoff after the app has stopped.

Run by updates.py only after an explicit Install action. The Windows launcher
mutex must be released before NSIS starts. Debian installers request their own
administrator authorization; Frameinsight never collects a password.
"""
import argparse
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
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


def installer_command(kind, package, installer=None):
    if kind == 'windows':
        return [str(package)]
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--size', required=True, type=int)
    parser.add_argument('--server', required=True, type=int)
    parser.add_argument('--launcher', type=int)
    parser.add_argument('--platform', required=True, choices=['windows', 'debian'])
    parser.add_argument('--installer')
    args = parser.parse_args()
    log = args.package.parent / 'install-handoff.log'
    try:
        wait_for_exit([pid for pid in (args.server, args.launcher) if pid])
        if args.package.is_symlink() or not args.package.is_file() or args.package.stat().st_size != args.size:
            raise ValueError('The downloaded package changed before installation. Nothing was installed.')
        digest = hashlib.sha256()
        with args.package.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != args.sha256:
            raise ValueError('The downloaded package checksum changed. Nothing was installed.')
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
