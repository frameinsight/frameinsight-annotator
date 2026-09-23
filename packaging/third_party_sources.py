"""Collect checksum-pinned upstream video sources alongside public binary releases."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import tarfile
import time
import urllib.request

from release_manifest import release_version

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'packaging/third-party/sources.json'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def fetch(package, cache):
    name = package['filename']
    if Path(name).name != name or not package['url'].startswith('https://'):
        raise ValueError('Source archives require a plain filename and HTTPS URL')
    target = cache / name
    if target.is_file() and digest(target) == package['sha256']:
        return target
    temporary = cache / (name + '.part')
    last_error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(package['url'], headers={'User-Agent': 'Frameinsight-source-release/1'})
            with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as destination:
                while chunk := response.read(1024 * 1024): destination.write(chunk)
            if digest(temporary) != package['sha256']:
                raise ValueError('Checksum mismatch: ' + name)
            temporary.replace(target)
            print('Verified ' + name, flush=True)
            return target
        except Exception as error:
            temporary.unlink(missing_ok=True)
            last_error = error
            time.sleep(attempt + 1)
    raise RuntimeError('Could not obtain verified source ' + name) from last_error


def make_bundle(directory, cache):
    version = release_version()
    catalog = json.loads(CATALOG.read_text())
    requirement = (ROOT / 'packaging/windows/requirements.txt').read_text().splitlines()
    if 'av==' + catalog['pyav_version'] not in requirement:
        raise ValueError('Update the matching source catalog when changing the PyAV wheel version')
    directory.mkdir(parents=True, exist_ok=True); cache.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=5) as pool:
        archives = list(pool.map(lambda package: fetch(package, cache), catalog['packages']))
    destination = directory / f'frameinsight-{version}-third-party-sources.tar.gz'
    temporary = destination.with_suffix('.part')
    prefix = 'frameinsight-third-party-sources'
    files = [(path, prefix + '/archives/' + path.name) for path in archives]
    for name in ('sources.json', 'README.txt', 'GPL-3.txt'):
        files.append((CATALOG.parent / name, prefix + '/' + name))
    with temporary.open('wb') as output, gzip.GzipFile(filename='', fileobj=output, mode='wb', compresslevel=1, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w|') as tar:
            for path, name in sorted(files, key=lambda pair: pair[1]):
                info = tar.gettarinfo(path, arcname=name)
                info.uid = info.gid = info.mtime = 0; info.uname = info.gname = ''; info.mode = 0o644
                with path.open('rb') as source: tar.addfile(info, source)
    temporary.replace(destination)
    print(json.dumps({'path': str(destination), 'sha256': digest(destination), 'size': destination.stat().st_size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / '.frameinsight/third-party/source-cache')
    args = parser.parse_args()
    make_bundle(args.directory, args.cache)
