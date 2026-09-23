"""Bundle the manual runtime and build a data-preserving desktop Debian package."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import sysconfig

ROOT = Path(__file__).resolve().parents[2]


def copy_source(destination):
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'backend', destination / 'backend', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    frontend = destination / 'frontend'
    shutil.copytree(ROOT / 'frontend/src', frontend / 'src')
    for name in ('package.json', 'package-lock.json', 'components.json', 'vite.config.ts', 'tsconfig.json', 'index.html'):
        shutil.copy(ROOT / 'frontend' / name, frontend / name)


def copy_notices(destination):
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / 'LICENSE', destination / 'Frameinsight-LICENSE.txt')
    if (ROOT / 'NOTICE.md').exists(): shutil.copy(ROOT / 'NOTICE.md', destination / 'Frameinsight-NOTICE.md')
    shutil.copy(ROOT / 'packaging/windows/THIRD-PARTY.txt', destination / 'THIRD-PARTY.txt')
    shutil.copy(ROOT / 'packaging/third-party/GPL-3.txt', destination / 'FFmpeg-GPL-3.txt')
    shutil.copy(ROOT / 'packaging/third-party/README.txt', destination / 'VIDEO-LIBRARY-SOURCES.txt')
    shutil.copy(ROOT / 'packaging/third-party/sources.json', destination / 'video-library-sources.json')
    shutil.copy(ROOT / 'frontend/src/components/ui/LICENSE', destination / 'shadcn-ui-LICENSE.txt')
    python_license = Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt'
    if python_license.is_file(): shutil.copy(python_license, destination / 'Python-LICENSE.txt')
    # Binary dependency analysis can include ordinary Debian runtime libraries.
    # Carry their distribution copyright files as well as wheel notices.
    for copyright_file in Path('/usr/share/doc').glob('*/copyright'):
        if copyright_file.is_file():
            target = destination / 'debian' / copyright_file.parent.name / 'copyright'
            target.parent.mkdir(parents=True, exist_ok=True); shutil.copy(copyright_file, target)
    for distribution in importlib.metadata.distributions():
        for relative in distribution.files or ():
            if any(part.lower().startswith(('license', 'copying', 'notice')) for part in relative.parts):
                source = Path(distribution.locate_file(relative))
                if source.is_file():
                    normalized = Path(*[part for part in relative.parts if part not in ('.', '..')])
                    target = destination / 'python' / distribution.metadata['Name'] / normalized
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy(source, target)
    lock = json.loads((ROOT / 'frontend/package-lock.json').read_text())
    for relative, metadata in lock['packages'].items():
        if not relative.startswith('node_modules/') or metadata.get('dev') and relative != 'node_modules/tailwindcss':
            continue
        for source in (ROOT / 'frontend' / relative).iterdir():
            if source.is_file() and source.name.lower().startswith(('license', 'copying', 'notice')):
                target = destination / 'frontend' / relative.removeprefix('node_modules/') / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(source, target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build = args.output.resolve(); build.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT / 'frontend/package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Desktop releases require a stable major.minor.patch version')
    if not (ROOT / 'frontend/dist/index.html').is_file():
        raise ValueError('Build the frontend before packaging')
    frontend = build / 'frontend'
    if frontend.exists(): shutil.rmtree(frontend)
    shutil.copytree(ROOT / 'frontend/dist', frontend / 'dist', ignore=shutil.ignore_patterns('*.map'))
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--noupx',
               '--name', 'Frameinsight', '--distpath', str(build / 'dist'), '--workpath', str(build / 'work'),
               '--specpath', str(build), '--paths', str(ROOT), '--add-data', str(frontend / 'dist') + ':frontend/dist',
               '--collect-all', 'av', '--collect-all', 'PIL', '--collect-submodules', 'uvicorn',
               '--collect-submodules', 'websockets', '--collect-submodules', 'backend',
               '--exclude-module', 'torch', '--exclude-module', 'ultralytics', '--exclude-module', 'cv2']
    for unused in ('readline', '_curses', 'tkinter', 'PIL.ImageTk'):
        command.extend(['--exclude-module', unused])
    for name in ('fastapi', 'pydantic', 'uvicorn', 'websockets', 'av', 'Pillow'):
        command.extend(['--recursive-copy-metadata', name])
    environment = dict(os.environ)
    environment.update(FRAMEINSIGHT_DATA=str(build / 'analysis-data'), FRAMEINSIGHT_WORKSPACE=str(build / 'analysis-workspace'), FRAMEINSIGHT_MODELS=str(build / 'analysis-models'))
    subprocess.run([*command, str(ROOT / 'packaging/debian/launcher.py')], check=True, cwd=ROOT, env=environment)
    stage = build / 'deb-root'
    if stage.exists(): shutil.rmtree(stage)
    runtime = stage / 'opt/frameinsight'
    shutil.copytree(build / 'dist/Frameinsight', runtime)
    # libc6 is an explicit package dependency. Its vector math companion must
    # match the host's libc; do not ship a second copy from the build container.
    (runtime / '_internal/libmvec.so.1').unlink(missing_ok=True)
    manifest = {'app': 'Frameinsight', 'version': version, 'platform': 'linux-amd64',
                'target': 'Ubuntu 24.04+ / Debian 12+, x86-64, glibc 2.36+', 'python': sys.version.split()[0],
                'source_commit': os.environ.get('FRAMEINSIGHT_BUILD_COMMIT'), 'media_included': False,
                'dependencies': {d.metadata['Name']: d.version for d in importlib.metadata.distributions()}}
    manifest['source_tree_dirty'] = os.environ.get('FRAMEINSIGHT_BUILD_DIRTY') != 'false'
    manifest['base_commit'] = manifest['source_commit']
    if manifest['source_tree_dirty']: manifest['source_commit'] = None
    manifest['runtime_files'] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for base in (ROOT / 'backend', ROOT / 'frontend/dist') for path in sorted(base.rglob('*')) if path.is_file() and (path.suffix == '.py' or base.name == 'dist') and '__pycache__' not in path.parts and path.suffix != '.map'}
    manifest['runtime_files']['packaging/debian/launcher.py'] = hashlib.sha256((ROOT / 'packaging/debian/launcher.py').read_bytes()).hexdigest()
    (runtime / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    documentation = stage / 'usr/share/doc/frameinsight'; documentation.mkdir(parents=True)
    copy_notices(documentation / 'licenses'); copy_source(documentation / 'source')
    shutil.copy(ROOT / 'packaging/debian/START-HERE.txt', documentation / 'START-HERE.txt')
    shutil.copy(ROOT / 'README.md', documentation / 'README.md')
    for name in ('USER_GUIDE.md', 'ANNOTATION_JSON.md', 'LINUX.md'):
        shutil.copy(ROOT / 'docs' / name, documentation / name)
    launcher = stage / 'usr/bin/frameinsight'; launcher.parent.mkdir(parents=True)
    launcher.write_text('#!/bin/sh\nexec /opt/frameinsight/Frameinsight "$@"\n'); launcher.chmod(0o755)
    applications = stage / 'usr/share/applications'; applications.mkdir(parents=True)
    shutil.copy(ROOT / 'packaging/debian/frameinsight.desktop', applications)
    icons = stage / 'usr/share/icons/hicolor/scalable/apps'; icons.mkdir(parents=True)
    shutil.copy(ROOT / 'packaging/debian/frameinsight.svg', icons)
    installed_kib = sum(path.stat().st_size for path in stage.rglob('*') if path.is_file()) // 1024
    control = stage / 'DEBIAN'; control.mkdir()
    (control / 'control').write_text(f'''Package: frameinsight
Version: {version}
Section: graphics
Priority: optional
Architecture: amd64
Maintainer: Frameinsight contributors
Installed-Size: {installed_kib}
Depends: libc6 (>= 2.36), libgcc-s1, libstdc++6, zlib1g, libglib2.0-0, libgl1, libx11-6, libxext6, libxcb1, libgomp1, ca-certificates, xdg-utils, zenity
Recommends: gdebi
Homepage: https://github.com/frameinsight/frameinsight-annotator
Description: Local desktop video annotation and tracking
 Draw and track people, interpolate boxes, review the annotated video,
 and export validated annotation JSON. Python and video libraries are
 bundled. Project data is stored per user and preserved during removal.
''')
    for name in ('preinst', 'prerm'):
        shutil.copy(ROOT / 'packaging/debian/maintainer-check.sh', control / name)
        (control / name).chmod(0o755)
    (control / 'postinst').write_text('#!/bin/sh\nset -e\nif command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi\nexit 0\n')
    (control / 'postinst').chmod(0o755)
    output = build / f'frameinsight_{version}_amd64.deb'
    subprocess.run(['dpkg-deb', '--root-owner-group', '--build', '--uniform-compression', '-Zxz', str(stage), str(output)], check=True)
    print(json.dumps({'path': str(output), 'size': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
