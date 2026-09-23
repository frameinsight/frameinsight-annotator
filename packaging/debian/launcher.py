"""Desktop entry point for the self-contained Debian package (no system Python)."""
from __future__ import annotations

import argparse
import fcntl
import json
import multiprocessing
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time

APP_URL = 'http://127.0.0.1:{port}/'


def locations():
    home = Path.home()
    data = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'frameinsight'
    state = Path(os.environ.get('XDG_STATE_HOME', home / '.local/state')) / 'frameinsight'
    for directory in (data, state, data / 'data', data / 'workspace', data / 'models'):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return data, state


def process_start(pid):
    """Linux process start ticks distinguish a saved PID from a later reused PID."""
    try:
        fields = Path(f'/proc/{int(pid)}/stat').read_text().rsplit(')', 1)[1].split()
        return None if fields[0] == 'Z' else fields[19]
    except (OSError, ValueError, IndexError):
        return None


def read_session(state):
    try:
        session = json.loads((state / 'session.json').read_text())
        return session if session.get('start_ticks') and process_start(session['pid']) == session['start_ticks'] else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def write_session(state, session):
    target = state / 'session.json'
    temporary = state / f'session-{os.getpid()}.tmp'
    temporary.write_text(json.dumps(session))
    temporary.chmod(0o600)
    temporary.replace(target)


def desktop_command(arguments):
    # PyInstaller's library path must not leak into the user's system programs.
    environment = dict(os.environ)
    original = environment.pop('LD_LIBRARY_PATH_ORIG', None)
    if original is None:
        environment.pop('LD_LIBRARY_PATH', None)
    else:
        environment['LD_LIBRARY_PATH'] = original
    return subprocess.run(arguments, env=environment, check=False)


def notify(text, error=False):
    if os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'):
        try:
            desktop_command(['/usr/bin/zenity', '--error' if error else '--info', '--title=Frameinsight', '--text=' + text, '--width=420'])
            return
        except OSError:
            pass
    print(text, file=sys.stderr if error else sys.stdout)


def stop(state, confirm):
    session = read_session(state)
    if not session:
        return 0
    if confirm:
        try:
            result = desktop_command(['/usr/bin/zenity', '--question', '--title=Close Frameinsight', '--text=Finish saving in the browser, then close Frameinsight? Your saved projects will stay on this computer.', '--ok-label=Close Frameinsight', '--cancel-label=Keep open', '--width=420'])
        except OSError:
            notify('Close confirmation could not open. Run frameinsight --stop --yes after saving.', True)
            return 1
        if result.returncode:
            return 0
    try:
        os.kill(session['pid'], signal.SIGTERM)
    except ProcessLookupError:
        return 0
    for _ in range(300):
        if process_start(session['pid']) != session['start_ticks']:
            return 0
        time.sleep(.1)
    notify('Frameinsight is finishing a running task before closing. Wait for it to finish before installing an update.')
    return 0


def serve(data, state, port):
    lock = (state / 'server.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return 0
    os.environ.setdefault('FRAMEINSIGHT_DATA', str(data / 'data'))
    os.environ.setdefault('FRAMEINSIGHT_WORKSPACE', str(data / 'workspace'))
    os.environ.setdefault('FRAMEINSIGHT_MODELS', str(data / 'models'))
    os.environ['FRAMEINSIGHT_PACKAGE_KIND'] = 'debian'
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', port))
    listener.listen(128)
    from backend.app.main import app
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, access_log=False, loop='asyncio', http='h11', ws='websockets'))
    app.state.update_shutdown = lambda: setattr(server, 'should_exit', True)
    session = {'pid': os.getpid(), 'start_ticks': process_start(os.getpid()), 'port': port, 'ready': False}
    write_session(state, session)
    finished = threading.Event()

    def ready():
        while not finished.wait(.1):
            if server.started:
                write_session(state, {**session, 'ready': True})
                return

    watcher = threading.Thread(target=ready, daemon=True)
    watcher.start()
    try:
        server.run(sockets=[listener])
    finally:
        finished.set()
        watcher.join(timeout=2)
        if (current := read_session(state)) and current['pid'] == os.getpid():
            (state / 'session.json').unlink(missing_ok=True)
        listener.close()
        lock.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description='Frameinsight desktop annotation app')
    parser.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--stop', action='store_true', help='Close Frameinsight after saving')
    parser.add_argument('--yes', action='store_true', help='Skip the close confirmation')
    parser.add_argument('--no-browser', action='store_true', help='Start without opening the browser')
    parser.add_argument('--open-data', action='store_true', help='Open the saved-work folder')
    parser.add_argument('--port', type=int, default=8765, help=argparse.SUPPRESS)
    args = parser.parse_args()
    data, state = locations()
    if args.serve:
        return serve(data, state, args.port)
    if args.stop:
        return stop(state, not args.yes)
    if args.open_data:
        return desktop_command(['/usr/bin/xdg-open', str(data)]).returncode
    session = read_session(state)
    child = None
    if not session:
        log = state / 'server.log'
        if log.exists() and log.stat().st_size > 4 * 1024 * 1024:
            log.replace(state / 'server.previous.log')
        command = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, str(Path(__file__).resolve())]
        with log.open('a') as output:
            child = subprocess.Popen([*command, '--serve', '--port', str(args.port)], stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    for _ in range(1200):
        session = read_session(state)
        if session and session.get('ready'):
            if not args.no_browser:
                desktop_command(['/usr/bin/xdg-open', APP_URL.format(port=session['port'])])
            return 0
        if child and child.poll() not in (None, 0):
            break
        time.sleep(.1)
    notify('Frameinsight could not start. Another app may be using port 8765. Close other copies and try again. Your saved work is unchanged.\n\nDetails: ' + str(state / 'server.log'), True)
    return 1


if __name__ == '__main__':
    multiprocessing.freeze_support()
    if sys.argv[1:2] == ['--update-helper']:
        del sys.argv[1]
        from backend.app.update_handoff import main as update_handoff
        sys.exit(update_handoff())
    sys.exit(main())
