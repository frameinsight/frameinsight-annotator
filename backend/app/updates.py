"""Optional updates from one public release repository; annotations stay local.

Release metadata never supplies commands or arbitrary paths. Downloads are bounded,
matched to a platform asset and SHA-256 verified before either delivery or launch.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import db
from .config import DATA
from .version import APP_VERSION

REPOSITORY = 'frameinsight/frameinsight-annotator'
RELEASE_API = f'https://api.github.com/repos/{REPOSITORY}/releases/latest'
RELEASE_PAGE = f'https://github.com/{REPOSITORY}/releases'
MAX_METADATA = 1024 * 1024
MAX_INSTALLER = 2 * 1024 ** 3
METADATA_TIMEOUT = 15
DOWNLOAD_TIMEOUT = 20 * 60
VERSION_RE = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
HASH_RE = re.compile(r'^[0-9a-fA-F]{64}$')


def version_tuple(value):
    if not isinstance(value, str) or len(value) > 32 or not VERSION_RE.fullmatch(value):
        raise ValueError('Release version must be a stable major.minor.patch version')
    return tuple(int(part) for part in value.split('.'))


def platform_info():
    system, machine = platform.system(), platform.machine().lower()
    package = os.getenv('FRAMEINSIGHT_PACKAGE_KIND', '')
    if machine not in ('amd64', 'x86_64'):
        return 'unsupported', None
    if system == 'Windows':
        return ('windows' if package == 'windows' else 'development'), 'windows-x64'
    if system == 'Linux':
        return ('debian' if package == 'debian' else 'development'), 'linux-amd64'
    return 'unsupported', None


def trusted_url(url, *, metadata=False):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError('Release download must use trusted HTTPS')
    if metadata:
        allowed = parsed.netloc == 'api.github.com' and parsed.path == f'/repos/{REPOSITORY}/releases/latest' and not parsed.query
    else:
        allowed = ((parsed.hostname == 'github.com' and parsed.path.startswith(f'/{REPOSITORY}/releases/download/'))
                   or parsed.hostname in ('release-assets.githubusercontent.com', 'objects.githubusercontent.com'))
    if not allowed:
        raise ValueError('Release download is outside the trusted repository or GitHub asset hosts')
    return url


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    def __init__(self, metadata=False):
        super().__init__()
        self.metadata = metadata

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        trusted_url(newurl, metadata=self.metadata)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_response(url, *, metadata=False):
    trusted_url(url, metadata=metadata)
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json' if metadata else 'application/octet-stream',
        'User-Agent': f'Frameinsight/{APP_VERSION}', 'Accept-Encoding': 'identity',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    return urllib.request.build_opener(SafeRedirect(metadata)).open(request, timeout=8)


def fetch_json(url, *, metadata=False):
    started = time.monotonic()
    chunks, count = [], 0
    with open_response(url, metadata=metadata) as response:
        while True:
            if time.monotonic() - started > METADATA_TIMEOUT:
                raise TimeoutError('Release information timed out')
            chunk = response.read1(64 * 1024)
            if not chunk:
                break
            count += len(chunk)
            if count > MAX_METADATA:
                raise ValueError('Release information exceeds the size limit')
            chunks.append(chunk)
    value = json.loads(b''.join(chunks))
    if not isinstance(value, dict):
        raise ValueError('Invalid release information')
    return value


def asset_url(asset, tag, name):
    expected = f'https://github.com/{REPOSITORY}/releases/download/{tag}/{name}'
    if asset.get('browser_download_url') != expected or asset.get('state', 'uploaded') != 'uploaded':
        raise ValueError('Release asset does not belong to the expected repository and version')
    trusted_url(expected)
    return expected


def discover_release(platform_key):
    release = fetch_json(RELEASE_API, metadata=True)
    tag = release.get('tag_name', '')
    version = tag.removeprefix('v')
    version_tuple(version)
    if release.get('draft') or release.get('prerelease'):
        raise ValueError('Only stable published releases are supported')
    result = {'version': version, 'release_notes': str(release.get('body') or '')[:60000],
              'release_url': f'{RELEASE_PAGE}/tag/{tag}'}
    if version_tuple(version) <= version_tuple(APP_VERSION) or platform_key is None:
        return result
    assets = release.get('assets')
    if not isinstance(assets, list):
        raise ValueError('Release has no downloadable packages')
    def select(name):
        matching = [item for item in assets if isinstance(item, dict) and item.get('name') == name]
        if len(matching) != 1:
            raise ValueError(f'Release is missing one unambiguous {name} asset')
        return matching[0]
    manifest_asset = select('release-manifest.json')
    manifest = fetch_json(asset_url(manifest_asset, tag, 'release-manifest.json'))
    if manifest.get('version') != version or not isinstance(manifest.get('assets'), list):
        raise ValueError('Release manifest version does not match the release')
    name = 'Window_setup.exe' if platform_key == 'windows-x64' else f'frameinsight_{version}_amd64.deb'
    entries = [item for item in manifest['assets'] if isinstance(item, dict) and item.get('platform') == platform_key]
    if len(entries) != 1 or entries[0].get('name') != name:
        raise ValueError('Release manifest does not contain the expected platform package')
    entry, asset = entries[0], select(name)
    size = entry.get('size')
    if type(size) is not int or not 0 < size <= MAX_INSTALLER or asset.get('size') != size:
        raise ValueError('Release package has an invalid or inconsistent size')
    digest = entry.get('sha256', '')
    if not isinstance(digest, str) or not HASH_RE.fullmatch(digest):
        raise ValueError('Release package is missing a valid SHA-256 checksum')
    if asset.get('digest') and asset['digest'].lower() != f'sha256:{digest.lower()}':
        raise ValueError('GitHub and manifest package checksums disagree')
    result['asset'] = {'name': name, 'size': size, 'sha256': digest.lower(),
                       'url': asset_url(asset, tag, name), 'platform': platform_key}
    return result


def verify_file(path, asset):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != asset['size']:
        raise ValueError('Downloaded package is missing or has changed. Download it again.')
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != asset['sha256']:
        raise ValueError('Downloaded package checksum failed. Download it again.')


class UpdateService:
    def __init__(self, directory=None):
        self.directory = Path(directory or DATA / 'updates')
        self.lock = threading.RLock()
        self.candidate = None
        self.checked_at = 0
        self.check_result = None
        self.state = {'status': 'idle', 'progress': 0, 'downloaded_bytes': 0, 'total_bytes': 0}
        self.path = None
        self.ready_candidate = None

    @property
    def installing(self):
        with self.lock:
            return self.state['status'] == 'installing'

    def check(self, force=False):
        kind, key = platform_info()
        with self.lock:
            if not force and self.check_result and time.monotonic() - self.checked_at < 3600:
                return dict(self.check_result)
        result = {'current_version': APP_VERSION, 'platform': kind, 'can_install': kind in ('windows', 'debian')}
        try:
            release = discover_release(key)
            newer = version_tuple(release['version']) > version_tuple(APP_VERSION)
            result.update(status='available' if newer and release.get('asset') else 'current',
                          latest_version=release['version'], release_notes=release['release_notes'], release_url=release['release_url'])
            if newer and not release.get('asset'):
                result.update(status='unavailable', message='This computer has no supported update package. Check the release page.')
            if release.get('asset'):
                result['asset'] = {key: release['asset'][key] for key in ('name', 'size')}
                if kind == 'development':
                    result['message'] = 'Development checkout: download the installer for a separate installation. Your checkout is not changed.'
            with self.lock:
                self.candidate = release if newer and release.get('asset') else None
        except urllib.error.HTTPError as error:
            message = ('No public release is available yet. You can keep working offline.' if error.code == 404
                       else 'The release service is unavailable. You can keep working and check again later.')
            result.update(status='unavailable', message=message)
        except (OSError, ValueError, KeyError, TypeError) as error:
            result.update(status='offline' if isinstance(error, OSError) else 'unavailable',
                          message='Update check unavailable. You can keep working and check again later.')
        with self.lock:
            self.check_result, self.checked_at = result, time.monotonic()
        return dict(result)

    def status(self):
        with self.lock:
            result = dict(self.state)
        result['can_install'] = platform_info()[0] in ('windows', 'debian')
        if result['status'] in ('ready', 'error') and self.ready_candidate and self.path:
            result['download_url'] = '/api/updates/downloaded'
        return result

    def download(self, version):
        version_tuple(version)
        with self.lock:
            if self.state['status'] in ('downloading', 'installing'):
                raise ValueError('An update is already in progress')
        self.check(force=True)
        with self.lock:
            if self.state['status'] in ('downloading', 'installing'):
                raise ValueError('An update is already in progress')
            candidate = self.candidate
            if self.check_result.get('status') != 'available' or not candidate or candidate['version'] != version:
                raise ValueError('This version is not the latest verified release. Check for updates again.')
            if self.state['status'] == 'ready' and self.ready_candidate == candidate and self.path:
                verify_file(self.path, candidate['asset'])
                return self.status()
            self.state = {'status': 'downloading', 'version': version, 'progress': 0,
                          'downloaded_bytes': 0, 'total_bytes': candidate['asset']['size']}
            self.ready_candidate, self.path = None, None
            threading.Thread(target=self._download, args=(candidate,), daemon=True, name='update-download').start()
            return self.status()

    def _download(self, candidate):
        asset = candidate['asset']
        temporary = None
        try:
            target_dir = self.directory / candidate['version']
            target_dir.mkdir(parents=True, exist_ok=True)
            if target_dir.is_symlink() or self.directory.is_symlink():
                raise ValueError('Update directory must not be a symbolic link')
            target = target_dir / asset['name']
            # A browser or app restart need not download the same large package
            # again. Its bytes must still match freshly checked release metadata.
            if target.exists() and not target.is_symlink():
                try:
                    verify_file(target, asset)
                except ValueError:
                    pass
                else:
                    with self.lock:
                        self.path, self.ready_candidate = target, candidate
                        self.state.update(status='ready', progress=1, downloaded_bytes=asset['size'], total_bytes=asset['size'],
                                          message='Verified cached update ready. Save your work, then choose Install update.')
                    return
            if shutil.disk_usage(target_dir).free < asset['size'] + 64 * 1024 ** 2:
                raise ValueError('Not enough free disk space to download this update')
            temporary = target.with_suffix(target.suffix + '.part')
            if temporary.exists() or temporary.is_symlink():
                temporary.unlink()
            downloaded, started = 0, time.monotonic()
            digest = hashlib.sha256()
            with open_response(asset['url']) as response, temporary.open('xb') as destination:
                length = response.headers.get('Content-Length')
                if length is not None and int(length) != asset['size']:
                    raise ValueError('Release download size does not match the manifest')
                while True:
                    if time.monotonic() - started > DOWNLOAD_TIMEOUT:
                        raise TimeoutError('Update download timed out. Please try again.')
                    chunk = response.read1(1024 * 1024)
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > asset['size']:
                        raise ValueError('Release download exceeds its expected size')
                    destination.write(chunk)
                    digest.update(chunk)
                    with self.lock:
                        self.state.update(downloaded_bytes=downloaded, progress=round(downloaded / asset['size'], 4))
                destination.flush()
                os.fsync(destination.fileno())
            if downloaded != asset['size'] or digest.hexdigest() != asset['sha256']:
                raise ValueError('Update checksum verification failed. Nothing was installed.')
            os.replace(temporary, target)
            with self.lock:
                self.path, self.ready_candidate = target, candidate
                self.state.update(status='ready', progress=1, message='Verified update ready. Save your work, then choose Install update.')
        except Exception as error:
            if temporary:
                temporary.unlink(missing_ok=True)
            with self.lock:
                self.state.update(status='error', message=str(error)[:400])

    def verified_download(self, version=None):
        with self.lock:
            if self.state['status'] not in ('ready', 'error') or not self.path or not self.ready_candidate:
                raise ValueError('Download and verify the update first')
            if version and self.ready_candidate['version'] != version:
                raise ValueError('Requested version is not the downloaded update')
            verify_file(self.path, self.ready_candidate['asset'])
            return self.path, self.ready_candidate

    def install(self, app, version):
        path, candidate = self.verified_download(version)
        kind, _ = platform_info()
        if kind == 'development':
            return {'action': 'manual', 'download_url': '/api/updates/downloaded',
                    'message': 'Download the verified package and install it separately. This development checkout is unchanged.'}
        if kind not in ('windows', 'debian'):
            raise ValueError('Automatic installation is unavailable on this platform')
        shutdown = getattr(app.state, 'update_shutdown', None)
        if not callable(shutdown):
            raise ValueError('This launcher does not support safe update shutdown. Save your work, close Frameinsight, and install the downloaded package manually.')
        with db.transaction() as connection:
            if any(json.loads(row['data']).get('status') in ('queued', 'running') for row in connection.execute('SELECT data FROM jobs')):
                raise ValueError('Wait for video imports, renders, and exports to finish before installing an update.')
        helper = [sys.executable, '--update-helper'] if getattr(sys, 'frozen', False) else [sys.executable, str(Path(__file__).with_name('update_handoff.py'))]
        command = [*helper, '--package', str(path),
                   '--sha256', candidate['asset']['sha256'], '--size', str(candidate['asset']['size']),
                   '--server', str(os.getpid()), '--platform', kind]
        if kind == 'windows':
            launcher = os.getenv('FRAMEINSIGHT_LAUNCHER_PID', '')
            if not launcher.isdecimal() or int(launcher) <= 0:
                raise ValueError('Cannot identify the desktop launcher. Close the app and install the downloaded update manually.')
            command.extend(['--launcher', launcher])
        else:
            installer = debian_installer(path)
            if not installer:
                raise ValueError('No supported system package installer was found. Download the verified .deb and open it with your software installer.')
            command.extend(['--installer', installer])
        with self.lock:
            if self.state['status'] != 'ready':
                raise ValueError('An update is already in progress')
            subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             **({'creationflags': subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP} if kind == 'windows' else {'start_new_session': True}))
            self.state.update(status='installing', message='Closing Frameinsight so the system installer can open. Follow its prompts to complete the update.')
        def close():
            try:
                shutdown()
            except Exception:
                with self.lock:
                    self.state.update(status='error', message='Could not close Frameinsight. Close it manually before installing the downloaded update.')
        timer = threading.Timer(1, close)
        timer.daemon = True
        timer.start()
        return {'action': 'closing', 'message': self.state['message']}


def debian_installer(path=None):
    # Explicit package installers, never the default file association (which may
    # be an archive viewer). Their normal GUI handles privilege authorization.
    return next((name for name in ('gdebi-gtk', 'qapt-deb-installer', 'gnome-software') if shutil.which(name)), None)


service = UpdateService()
router = APIRouter(prefix='/api/updates', tags=['updates'])


class UpdateVersion(BaseModel):
    version: str


@router.get('/check')
def check_updates(force: bool = False):
    return service.check(force)


@router.get('/status')
def update_status():
    return service.status()


@router.post('/download')
def download_update(body: UpdateVersion):
    return service.download(body.version)


@router.get('/downloaded')
def downloaded_update():
    path, _ = service.verified_download()
    return FileResponse(path, filename=path.name, media_type='application/octet-stream')


@router.post('/install')
def install_update(body: UpdateVersion, request: Request):
    return service.install(request.app, body.version)
