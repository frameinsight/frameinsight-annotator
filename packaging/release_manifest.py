"""Write the strictly scoped, platform-specific desktop update manifest."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def release_version(root=ROOT):
    version = json.loads((root / 'frontend/package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('A stable major.minor.patch release version is required')
    module = ast.parse((root / 'backend/app/version.py').read_text())
    backend = next(ast.literal_eval(node.value) for node in module.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'APP_VERSION' for target in node.targets))
    frontend = re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", (root / 'frontend/src/release.ts').read_text())
    lock = json.loads((root / 'frontend/package-lock.json').read_text())
    if backend != version or not frontend or frontend[1] != version or lock['version'] != version or lock['packages']['']['version'] != version:
        raise ValueError('Frontend, backend and lockfile release versions must match')
    return version


def write_manifest(directory, version):
    assets = []
    for platform, name in [('windows-x64', 'Window_setup.exe'), ('linux-amd64', f'frameinsight_{version}_amd64.deb')]:
        path = directory / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            raise ValueError('Missing release asset: ' + name)
        assets.append({'platform': platform, 'name': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'size': path.stat().st_size})
    result = {'version': version, 'assets': assets}
    manifest = directory / 'release-manifest.json'
    manifest.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    checksums = ''.join(f"{asset['sha256']}  {asset['name']}\n" for asset in assets)
    checksums += hashlib.sha256(manifest.read_bytes()).hexdigest() + '  release-manifest.json\n'
    sources = directory / f'frameinsight-{version}-third-party-sources.tar.gz'
    if sources.is_file() and not sources.is_symlink():
        checksums += hashlib.sha256(sources.read_bytes()).hexdigest() + '  ' + sources.name + '\n'
    (directory / 'SHA256SUMS.txt').write_text(checksums, encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--tag')
    args = parser.parse_args()
    current = release_version()
    if args.tag and args.tag != 'v' + current:
        raise SystemExit('Release tag must match the app version: v' + current)
    if args.directory:
        write_manifest(args.directory, current)
    print(current)
