import hashlib
import io
import json
import threading
import urllib.error
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from backend.app import updates
from backend.app import update_handoff
from backend.app.main import app


PACKAGE = b'Test installer payload, never executable.'
VERSION = '.'.join([*updates.APP_VERSION.split('.')[:2], str(int(updates.APP_VERSION.split('.')[2]) + 1)])
NAME = f'frameinsight_{VERSION}_amd64.deb'
URL = f'https://github.com/{updates.REPOSITORY}/releases/download/v{VERSION}/{NAME}'


def candidate():
    return {'version': VERSION, 'release_notes': 'Features\n- Custom classes\nFixes\n- Save reliably',
            'release_url': f'{updates.RELEASE_PAGE}/tag/v{VERSION}',
            'asset': {'name': NAME, 'url': URL, 'platform': 'linux-amd64',
                      'size': len(PACKAGE), 'sha256': hashlib.sha256(PACKAGE).hexdigest()}}


def release():
    value = candidate()
    return {'tag_name': f'v{VERSION}', 'body': value['release_notes'], 'draft': False, 'prerelease': False,
            'assets': [{'name': NAME, 'browser_download_url': URL, 'size': len(PACKAGE), 'state': 'uploaded',
                        'digest': 'sha256:' + value['asset']['sha256']},
                       {'name': 'release-manifest.json', 'browser_download_url': URL.rsplit('/', 1)[0] + '/release-manifest.json'}]}


def stub_discovery(monkeypatch, metadata=None, manifest=None):
    metadata = metadata if metadata is not None else release()
    manifest = manifest if manifest is not None else {'version': VERSION, 'assets': [candidate()['asset']]}
    calls = []
    def fetch(url, **kwargs):
        calls.append(url)
        return metadata if kwargs.get('metadata') else manifest
    monkeypatch.setattr(updates, 'fetch_json', fetch)
    return calls


class Response(io.BytesIO):
    def __init__(self, content=PACKAGE, length=None):
        super().__init__(content)
        self.headers = {} if length is None else {'Content-Length': str(length)}


@pytest.fixture
def updater(tmp_path, monkeypatch):
    monkeypatch.setattr(updates.db, 'DB', tmp_path / 'updates.sqlite3')
    monkeypatch.setattr(updates, 'platform_info', lambda: ('development', 'linux-amd64'))
    return updates.UpdateService(tmp_path / 'updates')


def ready(updater, monkeypatch):
    monkeypatch.setattr(updates, 'open_response', lambda *args, **kwargs: Response())
    updater.state = {'status': 'downloading', 'version': VERSION, 'progress': 0}
    updater._download(candidate())
    assert updater.status()['status'] == 'ready'


@pytest.mark.parametrize('version', ['3.1.0-beta', 'v3.1.0', '../3.1.0', '3.01.0', '3.1', '', '9' * 50 + '.0.0'])
def test_only_stable_semver(version):
    with pytest.raises(ValueError):
        updates.version_tuple(version)


def test_release_contract_new_stable_platform_and_notes(monkeypatch):
    stub_discovery(monkeypatch)
    result = updates.discover_release('linux-amd64')
    assert result == candidate()
    for flag in ('draft', 'prerelease'):
        metadata = release();metadata[flag] = True
        stub_discovery(monkeypatch, metadata)
        with pytest.raises(ValueError, match='stable'):
            updates.discover_release('linux-amd64')


def test_current_or_older_release_never_downloads_manifest(monkeypatch):
    for version in (updates.APP_VERSION, '2.0.0'):
        metadata = {'tag_name': 'v' + version, 'body': ''}
        calls = stub_discovery(monkeypatch, metadata)
        assert 'asset' not in updates.discover_release('linux-amd64')
        assert calls == [updates.RELEASE_API]


@pytest.mark.parametrize('url', ['http://github.com/frameinsight/frameinsight-annotator/releases/download/v3.1.0/Window_setup.exe',
                                'https://attacker.example/Window_setup.exe',
                                'https://github.com/another/repository/releases/download/v3.1.0/Window_setup.exe',
                                'https://github.com@attacker.example/file',
                                'https://release-assets.githubusercontent.com:444/file'])
def test_external_insecure_redirects_rejected(url):
    with pytest.raises(ValueError):
        updates.trusted_url(url)
    with pytest.raises(ValueError):
        updates.SafeRedirect().redirect_request(None, None, 302, 'Moved', {}, url)


def test_manifest_binding_checks_prevent_substitution(monkeypatch):
    for change in ('name', 'size', 'sha256', 'version', 'digest', 'url'):
        metadata = release()
        manifest = {'version': VERSION, 'assets': [dict(candidate()['asset'])]}
        if change == 'name':manifest['assets'][0]['name'] = '../Window_setup.exe'
        if change == 'size':manifest['assets'][0]['size'] += 1
        if change == 'sha256':manifest['assets'][0]['sha256'] = 'not-a-checksum'
        if change == 'version':manifest['version'] = '4.0.0'
        if change == 'digest':metadata['assets'][0]['digest'] = 'sha256:' + '0' * 64
        if change == 'url':metadata['assets'][0]['browser_download_url'] = URL.replace('frameinsight/frameinsight-annotator', 'bad/package')
        stub_discovery(monkeypatch, metadata, manifest)
        with pytest.raises(ValueError):
            updates.discover_release('linux-amd64')


def test_metadata_limit_and_offline_do_not_break_local_app(updater, monkeypatch):
    monkeypatch.setattr(updates, 'MAX_METADATA', 10)
    monkeypatch.setattr(updates, 'open_response', lambda *a, **kw: Response(b'{"padding":"too much metadata"}'))
    with pytest.raises(ValueError, match='size limit'):
        updates.fetch_json(updates.RELEASE_API, metadata=True)
    def offline(*args):raise OSError('Network unreachable')
    monkeypatch.setattr(updates, 'discover_release', offline)
    monkeypatch.setattr(updates, 'service', updater)
    with TestClient(app) as client:
        result = client.get('/api/updates/check').json()
        assert result['status'] == 'offline' and result['current_version'] == updates.APP_VERSION
        assert client.get('/api/projects').status_code == 200
    assert not updater.directory.exists()


def test_verified_download_streaming_and_second_verification(updater, monkeypatch):
    ready(updater, monkeypatch)
    path, _ = updater.verified_download(VERSION)
    assert path.read_bytes() == PACKAGE
    assert updater.status()['download_url'] == '/api/updates/downloaded'
    path.write_bytes(b'x' * len(PACKAGE))
    with pytest.raises(ValueError, match='checksum'):
        updater.verified_download(VERSION)


@pytest.mark.parametrize('payload,length', [(PACKAGE[:-1], None), (b'x' * len(PACKAGE), None), (PACKAGE + b'extra', None), (PACKAGE, 999)])
def test_invalid_partial_or_oversize_download_is_not_installable(updater, monkeypatch, payload, length):
    monkeypatch.setattr(updates, 'open_response', lambda *args, **kwargs: Response(payload, length))
    updater.state = {'status': 'downloading'}
    updater._download(candidate())
    assert updater.status()['status'] == 'error'
    assert not list(updater.directory.rglob('*.part'))
    with pytest.raises(ValueError, match='Download and verify'):
        updater.verified_download()


def test_download_deadline_and_disk_space_fail_cleanly(updater, monkeypatch):
    monkeypatch.setattr(updates.shutil, 'disk_usage', lambda path: SimpleNamespace(free=0))
    updater._download(candidate())
    assert updater.status()['status'] == 'error'
    assert 'disk space' in updater.status()['message']
    monkeypatch.setattr(updates.shutil, 'disk_usage', lambda path: SimpleNamespace(free=10**10))
    monkeypatch.setattr(updates, 'DOWNLOAD_TIMEOUT', -1)
    monkeypatch.setattr(updates, 'open_response', lambda *args, **kwargs: Response())
    updater._download(candidate())
    assert 'timed out' in updater.status()['message']
    assert not list(updater.directory.rglob('*.part'))


def test_only_user_requested_current_candidate_can_download(updater, monkeypatch):
    monkeypatch.setattr(updates, 'discover_release', lambda key: candidate())
    started = []
    monkeypatch.setattr(updates.threading, 'Thread', lambda **kwargs: SimpleNamespace(start=lambda: started.append(kwargs)))
    assert updater.check()['status'] == 'available'
    assert started == [] and not updater.directory.exists()
    with pytest.raises(ValueError, match='latest verified'):
        updater.download('3.0.1')
    assert updater.download(VERSION)['status'] == 'downloading'
    assert len(started) == 1
    with pytest.raises(ValueError, match='already in progress'):
        updater.download(VERSION)


def test_development_checkout_never_executes_installer(updater, monkeypatch):
    ready(updater, monkeypatch)
    monkeypatch.setattr(updates.subprocess, 'Popen', lambda *a, **kw: pytest.fail('Development install must not spawn a process'))
    result = updater.install(SimpleNamespace(state=SimpleNamespace()), VERSION)
    assert result['action'] == 'manual'
    assert updater.status()['status'] == 'ready'


def fake_jobs(monkeypatch, jobs):
    @contextmanager
    def transaction():
        yield SimpleNamespace(execute=lambda *args: [{'data': json.dumps(job)} for job in jobs])
    monkeypatch.setattr(updates.db, 'transaction', transaction)


def test_install_rejects_missing_launcher_and_active_jobs(updater, monkeypatch):
    ready(updater, monkeypatch)
    monkeypatch.setattr(updates, 'platform_info', lambda: ('debian', 'linux-amd64'))
    with pytest.raises(ValueError, match='launcher'):
        updater.install(SimpleNamespace(state=SimpleNamespace()), VERSION)
    fake_jobs(monkeypatch, [{'status': 'running'}])
    with pytest.raises(ValueError, match='finish'):
        updater.install(SimpleNamespace(state=SimpleNamespace(update_shutdown=lambda: None)), VERSION)


def test_install_frozen_handoff_is_detached_after_explicit_click(updater, monkeypatch):
    ready(updater, monkeypatch)
    fake_jobs(monkeypatch, [])
    monkeypatch.setattr(updates, 'platform_info', lambda: ('debian', 'linux-amd64'))
    monkeypatch.setattr(updates, 'debian_installer', lambda *args: 'gdebi-gtk')
    monkeypatch.setattr(updates.sys, 'frozen', True, raising=False)
    launched, shutdown, timers = [], [], []
    monkeypatch.setattr(updates.subprocess, 'Popen', lambda args, **kwargs: launched.append((args, kwargs)))
    monkeypatch.setattr(updates.threading, 'Timer', lambda delay, action: SimpleNamespace(start=lambda: timers.append(action)))
    assert not launched
    result = updater.install(SimpleNamespace(state=SimpleNamespace(update_shutdown=lambda: shutdown.append(True))), VERSION)
    assert result['action'] == 'closing'
    assert launched[0][0][1] == '--update-helper'
    assert launched[0][1]['start_new_session'] is True
    assert '--sha256' in launched[0][0] and updater.installing
    assert not shutdown
    timers[0]()
    assert shutdown == [True]


def test_handoff_uses_argument_arrays_and_clean_system_library_environment(monkeypatch, tmp_path):
    monkeypatch.setattr(update_handoff.shutil, 'which', lambda name: '/usr/bin/' + name)
    path = tmp_path / 'package with spaces.deb'
    assert update_handoff.installer_command('debian', path, 'gdebi-gtk') == ['/usr/bin/gdebi-gtk', str(path)]
    assert update_handoff.installer_command('debian', path, 'gnome-software') == ['/usr/bin/gnome-software', '--local-filename=' + str(path)]
    with pytest.raises(ValueError):update_handoff.installer_command('debian', path, 'sh')
    monkeypatch.setenv('LD_LIBRARY_PATH', '/tmp/pyinstaller-libraries')
    monkeypatch.setenv('LD_LIBRARY_PATH_ORIG', '/usr/local/lib')
    assert update_handoff.system_environment()['LD_LIBRARY_PATH'] == '/usr/local/lib'
    monkeypatch.delenv('LD_LIBRARY_PATH_ORIG')
    assert 'LD_LIBRARY_PATH' not in update_handoff.system_environment()


def test_verified_package_api_and_install_mutation_guard(updater, monkeypatch):
    ready(updater, monkeypatch)
    monkeypatch.setattr(updates, 'service', updater)
    from backend.app import main
    monkeypatch.setattr(main, 'update_service', updater)
    with TestClient(app) as client:
        download = client.get('/api/updates/downloaded')
        assert download.status_code == 200 and download.content == PACKAGE
        assert client.post('/api/updates/install', json={'version': VERSION}).json()['action'] == 'manual'
        updater.state['status'] = 'installing'
        assert client.post('/api/projects', json={'name': 'Unsafe while closing'}).status_code == 503
        assert client.get('/api/updates/status').json()['status'] == 'installing'
        assert client.get('/api/projects').status_code == 200


def test_restart_reuses_verified_cached_package_without_network_or_extra_disk(updater, monkeypatch):
    ready(updater, monkeypatch)
    restarted = updates.UpdateService(updater.directory)
    monkeypatch.setattr(updates, 'open_response', lambda *a, **k: pytest.fail('Verified package must not be downloaded twice'))
    monkeypatch.setattr(updates.shutil, 'disk_usage', lambda path: SimpleNamespace(free=0))
    restarted._download(candidate())
    assert restarted.status()['status'] == 'ready'
    assert restarted.verified_download()[0].read_bytes() == PACKAGE


def test_failed_managed_shutdown_unblocks_edits_and_keeps_manual_package(updater, monkeypatch):
    ready(updater, monkeypatch)
    fake_jobs(monkeypatch, [])
    monkeypatch.setattr(updates, 'platform_info', lambda: ('debian', 'linux-amd64'))
    monkeypatch.setattr(updates, 'debian_installer', lambda *args: 'gdebi-gtk')
    monkeypatch.setattr(updates.subprocess, 'Popen', lambda *args, **kwargs: None)
    callbacks = []
    monkeypatch.setattr(updates.threading, 'Timer', lambda delay, action: SimpleNamespace(start=lambda: callbacks.append(action)))
    def failed_shutdown():raise OSError('Window unavailable')
    updater.install(SimpleNamespace(state=SimpleNamespace(update_shutdown=failed_shutdown)), VERSION)
    assert updater.installing
    callbacks[0]()
    assert not updater.installing and updater.status()['status'] == 'error'
    assert updater.status()['download_url'] == '/api/updates/downloaded'
    assert updater.verified_download()[0].read_bytes() == PACKAGE


@pytest.mark.skipif(update_handoff.sys.platform != 'linux', reason='Linux process lifecycle')
def test_handoff_recognizes_exited_unreaped_linux_server():
    import os
    import subprocess
    import sys
    child = subprocess.Popen([sys.executable, '-c', 'pass'])
    try:
        os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOWAIT)
        # kill(pid, 0) succeeds for a zombie; the helper must still proceed.
        os.kill(child.pid, 0)
        update_handoff.wait_for_exit([child.pid], timeout=.5)
    finally:
        child.wait(timeout=5)


def test_handoff_does_not_wait_for_a_reused_linux_pid(monkeypatch):
    monkeypatch.setattr(update_handoff.os, 'kill', lambda pid, signal: None)
    fields = ['S'] + ['0'] * 18 + ['new-start-time']
    monkeypatch.setattr(update_handoff.Path, 'read_text', lambda self: '123 (server) ' + ' '.join(fields))
    assert not update_handoff.linux_process_alive(123, {123: 'original-start-time'})
    assert update_handoff.linux_process_alive(123, {})
