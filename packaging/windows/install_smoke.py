"""Silent installation, upgrade and data-preserving uninstall acceptance."""
import hashlib,json,os,subprocess,sys,time
from pathlib import Path
build=Path(__file__).resolve().parent
installer=build/'output/Frameinsight-Setup-1.2.0-win64.exe'
root=Path(os.environ['LOCALAPPDATA'])/'Programs/Frameinsight'
def install():
 result=subprocess.run([str(installer),'/S'],timeout=90);assert result.returncode==0
 assert (root/'Frameinsight.exe').exists() and (root/'runtime/pythonw.exe').exists()
install()
import winreg
with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Uninstall\Frameinsight') as key:
 uninstall=winreg.QueryValueEx(key,'UninstallString')[0]
 assert uninstall=='"'+str(root/'Uninstall.exe')+'"',uninstall
assert (Path(os.environ['USERPROFILE'])/'Desktop/Frameinsight.lnk').exists()
result=subprocess.run([str(root/'runtime/python.exe'),'-B',str(build/'smoke.py'),str(root),str(build/'numbered.mp4')],timeout=180)
assert result.returncode==0
user_data=Path(os.environ['LOCALAPPDATA'])/'Frameinsight/Data/projects.sqlite3'
digest=hashlib.sha256(user_data.read_bytes()).hexdigest()
install();assert hashlib.sha256(user_data.read_bytes()).hexdigest()==digest
result=subprocess.run([str(root/'Uninstall.exe'),'/S','_?='+str(root)],timeout=90);assert result.returncode==0
for _ in range(40):
 if not (root/'Frameinsight.exe').exists():break
 time.sleep(.25)
assert not (root/'Frameinsight.exe').exists()
assert user_data.exists() and hashlib.sha256(user_data.read_bytes()).hexdigest()==digest
report={'environment':'Wine on Linux','checks':['silent per-user installation','desktop shortcut','quoted registered uninstaller','installed app end-to-end runtime smoke','upgrade preserves database','uninstall removes app','uninstall preserves database'],'native_windows_10_11_tested':False}
(build/'installer-smoke-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
