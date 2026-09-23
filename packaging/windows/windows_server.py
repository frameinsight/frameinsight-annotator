"""Bundled desktop server. Invoked by Frameinsight.exe, never by the end user."""
import argparse
import ctypes
import multiprocessing
import os
from pathlib import Path
import sys
import threading
import time
import traceback


def configure_paths():
    base = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Frameinsight'
    for name in ('Data', 'Workspace', 'Models', 'Logs'):
        (base / name).mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('FRAMEINSIGHT_DATA', str(base / 'Data'))
    os.environ.setdefault('FRAMEINSIGHT_WORKSPACE', str(base / 'Workspace'))
    os.environ.setdefault('FRAMEINSIGHT_MODELS', str(base / 'Models'))
    os.environ['FRAMEINSIGHT_PACKAGE_KIND'] = 'windows'
    return base


def main():
    multiprocessing.freeze_support()
    parser = argparse.ArgumentParser()
    parser.add_argument('--parent', type=int, default=0)
    args = parser.parse_args()
    base = configure_paths()
    if args.parent:
        os.environ['FRAMEINSIGHT_LAUNCHER_PID'] = str(args.parent)
    log = base / 'Logs' / 'server.log'
    if log.exists() and log.stat().st_size > 2 * 1024 * 1024:
        log.replace(base / 'Logs' / 'server.previous.log')
    stream = log.open('a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = stream
    try:
        import uvicorn
        from backend.app.main import app
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8765,
            access_log=False, loop='asyncio', http='h11', ws='websockets', use_colors=False))
        if os.name == 'nt' and args.parent:
            def update_shutdown():
                user = ctypes.WinDLL('user32', use_last_error=True)
                user.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
                user.FindWindowW.restype = ctypes.c_void_p
                user.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
                hwnd = user.FindWindowW('Frameinsight.Desktop.v1', None)
                if not hwnd or not user.PostMessageW(hwnd, 0x0010, 0, 0):
                    raise OSError('Unable to close the desktop launcher safely')
            app.state.update_shutdown = update_shutdown
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenEventW.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_wchar_p]
            kernel.OpenEventW.restype = ctypes.c_void_p
            kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            kernel.SetEvent.argtypes = kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            ready = kernel.OpenEventW(0x0002, False, 'Local\\Frameinsight.Ready.v1')
            stop = kernel.OpenEventW(0x100000, False, 'Local\\Frameinsight.Stop.v1')
            parent = kernel.OpenProcess(0x100000, False, args.parent)
            if not ready or not stop or not parent:
                raise OSError('Desktop launcher connection unavailable; open Frameinsight.exe again.')
            def lifecycle():
                announced = False
                while not server.should_exit:
                    if server.started and not announced:
                        kernel.SetEvent(ready); announced = True
                    if kernel.WaitForSingleObject(stop, 0) == 0 or kernel.WaitForSingleObject(parent, 0) == 0:
                        server.should_exit = True
                        break
                    time.sleep(.2)
                for handle in (ready, stop, parent): kernel.CloseHandle(handle)
            threading.Thread(target=lifecycle, daemon=True).start()
        server.run()
    except BaseException:
        traceback.print_exc()
        return 1
    finally:
        stream.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
