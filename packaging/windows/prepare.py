"""Prepare an offline Windows payload from the app and pinned official runtime."""
import hashlib, json, shutil, urllib.request, zipfile
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[2]
BUILD=ROOT/'.frameinsight/windows-build'
PAYLOAD=BUILD/'payload'
RUNTIME=PAYLOAD/'runtime'
VERSION='3.13.12'
SHA='76f238f606250c87c6beac75dccd35ee99070a13490555936abb6cb64ecce3d0'
archive=BUILD/f'python-{VERSION}-embed-amd64.zip'
if not archive.exists(): urllib.request.urlretrieve(f'https://www.python.org/ftp/python/{VERSION}/python-{VERSION}-embed-amd64.zip',archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==SHA, 'Python download checksum mismatch'
if PAYLOAD.exists(): shutil.rmtree(PAYLOAD)
RUNTIME.mkdir(parents=True)
with zipfile.ZipFile(archive) as z:z.extractall(RUNTIME)
site=RUNTIME/'Lib/site-packages';site.mkdir(parents=True)
for wheel in sorted((BUILD/'wheels').glob('*.whl')):
 with zipfile.ZipFile(wheel) as z:
  for name in z.namelist():
   if name.endswith('/'):continue
   parts=Path(name).parts
   if parts[0].endswith('.data'):
    if parts[1] not in ('purelib','platlib'):continue
    parts=parts[2:]
   target=site.joinpath(*parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
(RUNTIME/'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../app\nimport site\n')
app=PAYLOAD/'app';app.mkdir()
shutil.copy(ROOT/'README.md',app/'README.md')
shutil.copytree(ROOT/'backend',app/'backend',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
shutil.copytree(ROOT/'frontend/dist',app/'frontend/dist',ignore=shutil.ignore_patterns('*.map'))
shutil.copy(ROOT/'packaging/windows/windows_server.py',app/'windows_server.py')
shutil.copytree(ROOT/'docs',app/'docs',ignore=lambda p,n:[x for x in n if not x.endswith('.md')])
licenses=PAYLOAD/'licenses';licenses.mkdir()
shutil.copy(RUNTIME/'LICENSE.txt',licenses/'Python-LICENSE.txt')
for info in site.glob('*.dist-info'):
 for file in info.rglob('*'):
  if file.is_file() and ('license' in str(file).lower() or file.name.lower().startswith(('copying','notice'))):
   dest=licenses/info.name/file.relative_to(info);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy(file,dest)
shutil.copy(ROOT/'packaging/windows/START-HERE.txt',PAYLOAD/'START-HERE.txt')

shutil.copy(ROOT/'packaging/windows/THIRD-PARTY.txt',licenses/'THIRD-PARTY.txt')
shutil.copy('/usr/share/common-licenses/GPL-3',licenses/'FFmpeg-GPL-3.txt')
frontend_package=json.loads((ROOT/'frontend/package.json').read_text())
frontend_lock=json.loads((ROOT/'frontend/package-lock.json').read_text())
for relative, metadata in frontend_lock['packages'].items():
 if not relative.startswith('node_modules/') or metadata.get('dev') and relative!='node_modules/tailwindcss':continue
 dependency=ROOT/'frontend'/relative
 for f in dependency.iterdir():
  if f.is_file() and f.name.lower().startswith(('license','copying','notice')):
   destination=licenses/'frontend'/relative.removeprefix('node_modules/')/f.name
   destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy(f,destination)
shutil.copy(ROOT/'frontend/src/components/ui/LICENSE',licenses/'shadcn-ui-LICENSE.txt')
source=app/'frontend-source';source.mkdir()
shutil.copytree(ROOT/'frontend/src',source/'src')
for name in ('package.json','package-lock.json','index.html','components.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'):
 f=ROOT/'frontend'/name
 if f.exists():shutil.copy(f,source/name)

manifest={'app':'Frameinsight','version':frontend_package['version'],'target':'Windows 11 x64','python':VERSION,'python_sha256':SHA,'wheels':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((BUILD/'wheels').glob('*.whl'))},'media_included':False}
(PAYLOAD/'build-manifest.json').write_text(json.dumps(manifest,indent=2))
im=Image.new('RGBA',(256,256),'#151d24');draw=ImageDraw.Draw(im);draw.rounded_rectangle((24,24,232,232),radius=32,outline='#7fe5c0',width=16);draw.line((82,188,82,70,174,70),fill='#baa7ff',width=20);draw.line((82,126,155,126),fill='#baa7ff',width=20)
im.save(BUILD/'frameinsight.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
(BUILD/'launcher.rc').write_text('1 ICON "frameinsight.ico"\n')
for name in ('launcher.c','installer.nsi'):shutil.copy(ROOT/'packaging/windows'/name,BUILD/name)
(BUILD/'output').mkdir(exist_ok=True)
print(f'Prepared {PAYLOAD}: {sum(f.stat().st_size for f in PAYLOAD.rglob("*") if f.is_file())/1024**2:.1f} MiB')
