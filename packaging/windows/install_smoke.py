"""Silent installation, upgrade and data-preserving uninstall acceptance."""
import ctypes,hashlib,json,os,shutil,subprocess,sys,time,urllib.request
from pathlib import Path
build=Path(__file__).resolve().parent
def report_failure(kind, error, traceback):
 message=str(error)
 for name in ('install-handoff.log','install-process.log'):
  log=build/'automatic update'/name
  if log.exists():message+='\n'+name+':\n'+log.read_text(encoding='utf-8-sig',errors='replace')[-3000:]
 print('::error::'+message.replace('%','%25').replace('\r','%0D').replace('\n','%0A'),flush=True)
 sys.__excepthook__(kind,error,traceback)
sys.excepthook=report_failure
os.environ['FRAMEINSIGHT_DISABLE_AUTO_UPDATE']='1'  # Isolated tests control the candidate, never the live release.
installer=build/'output/Window_setup.exe'
root=Path(os.environ['LOCALAPPDATA'])/'Programs/Frameinsight'
app_version=json.loads((build/'payload/build-manifest.json').read_text())['version']
def install():
 result=subprocess.run([str(installer),'/S'],timeout=90);assert result.returncode==0
 assert (root/'Frameinsight.exe').exists() and (root/'runtime/pythonw.exe').exists()
install()
import winreg
with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight') as key:
 uninstall=winreg.QueryValueEx(key,'UninstallString')[0]
 assert uninstall=='"'+str(root/'Uninstall.exe')+'"',uninstall
 assert winreg.QueryValueEx(key,'DisplayVersion')[0]==app_version
assert json.loads((root/'build-manifest.json').read_text())['version']==app_version
assert (Path(os.environ['USERPROFILE'])/'Desktop/Frameinsight.lnk').exists()
(build/'windows-smoke-report.json').unlink(missing_ok=True)
result=subprocess.run([str(root/'runtime/python.exe'),'-B',str(build/'smoke.py'),str(root),str(build/'numbered.mp4')],timeout=180)
assert result.returncode==0
assert json.loads((build/'windows-smoke-report.json').read_text())['app_version']==app_version
user_data=Path(os.environ['LOCALAPPDATA'])/'Frameinsight/Data/projects.sqlite3'
digest=hashlib.sha256(user_data.read_bytes()).hexdigest()
install();assert hashlib.sha256(user_data.read_bytes()).hexdigest()==digest
# Exercise the real detached PowerShell handoff from the installed Python runtime.
# It must release its DLL locks, silently reinstall, and reopen the desktop app.
automatic=build/'automatic update';automatic.mkdir(exist_ok=True)
automatic_package=automatic/'Window_setup.exe';shutil.copy2(installer,automatic_package)
result=subprocess.run([str(root/'runtime/python.exe'),'-B',str(root/'app/backend/app/update_handoff.py'),
 '--package',str(automatic_package),'--size',str(automatic_package.stat().st_size),
 '--sha256',hashlib.sha256(automatic_package.read_bytes()).hexdigest(),'--server','2147483647',
 '--platform','windows','--automatic','--version',app_version,'--restart',str(root/'Frameinsight.exe')],timeout=20)
assert result.returncode==0
handoff_log=automatic/'install-handoff.log'
deadline=time.time()+120
while time.time()<deadline:
 log=handoff_log.read_text(encoding='utf-8-sig',errors='replace') if handoff_log.exists() else ''
 assert 'could not finish' not in log,log
 try:
  with urllib.request.urlopen('http://127.0.0.1:8765/openapi.json',timeout=2) as response:
   assert json.load(response)['info']['version']==app_version
  if 'Update installed. Reopening Frameinsight.' in log:break
 except OSError:pass
 time.sleep(.3)
else:raise AssertionError('Automatic Windows update/relaunch timed out: '+log)
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.CloseHandle.argtypes=[ctypes.c_void_p]
# Ask the launcher to close, exactly as the real update service does. Signaling
# only the server event makes the launcher report an unexpected server exit.
user=ctypes.WinDLL('user32',use_last_error=True)
user.FindWindowW.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p];user.FindWindowW.restype=ctypes.c_void_p
user.PostMessageW.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_ssize_t]
hwnd=user.FindWindowW('Frameinsight.Desktop.v1',None);assert hwnd
assert user.PostMessageW(hwnd,0x0010,0,0)
kernel.OpenMutexW.argtypes=[ctypes.c_ulong,ctypes.c_int,ctypes.c_wchar_p];kernel.OpenMutexW.restype=ctypes.c_void_p
for _ in range(150):
 mutex=kernel.OpenMutexW(0x100000,False,'Local\\Frameinsight.Desktop.v1')
 if not mutex:break
 kernel.CloseHandle(mutex);time.sleep(.2)
else:raise AssertionError('Updated app did not stop before uninstall')
assert hashlib.sha256(user_data.read_bytes()).hexdigest()==digest
result=subprocess.run([str(root/'Uninstall.exe'),'/S','_?='+str(root)],timeout=90);assert result.returncode==0
for _ in range(40):
 if not (root/'Frameinsight.exe').exists():break
 time.sleep(.25)
assert not (root/'Frameinsight.exe').exists()
assert user_data.exists() and hashlib.sha256(user_data.read_bytes()).hexdigest()==digest
report={'app_version':app_version,'environment':'Wine on Linux' if 'WINEPREFIX' in os.environ else 'Windows runner','checks':['silent per-user installation','desktop shortcut','quoted registered uninstaller','registry and manifest version match','installed app end-to-end runtime smoke','upgrade preserves database','automatic handoff releases installed Python DLLs before silent upgrade','automatic Windows upgrade reopens the installed app','automatic upgrade preserves database','uninstall removes app','uninstall preserves database'],'native_windows_10_11_tested':False}
(build/'installer-smoke-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
