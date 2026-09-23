"""Packaging contracts that must not touch live annotations or desktop sessions."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path

import pytest
fcntl = pytest.importorskip('fcntl', reason='Linux desktop session tests require flock')

ROOT = Path(__file__).resolve().parents[1]


def module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


linux = module('frameinsight_linux_launcher', 'packaging/debian/launcher.py')
release = module('frameinsight_release_manifest', 'packaging/release_manifest.py')


def test_linux_uses_per_user_xdg_folders_and_does_not_overwrite_data(tmp_path, monkeypatch):
    monkeypatch.setenv('XDG_DATA_HOME', str(tmp_path / 'data-root'))
    monkeypatch.setenv('XDG_STATE_HOME', str(tmp_path / 'state-root'))
    data, state = linux.locations()
    assert data == tmp_path / 'data-root/frameinsight'
    assert state == tmp_path / 'state-root/frameinsight'
    saved = data / 'data/keep.sqlite3'; saved.write_bytes(b'existing annotations')
    assert linux.locations() == (data, state)
    assert saved.read_bytes() == b'existing annotations'


def test_session_requires_matching_process_start_ticks(tmp_path):
    session = {'pid': os.getpid(), 'start_ticks': linux.process_start(os.getpid()), 'port': 8765, 'ready': True}
    linux.write_session(tmp_path, session)
    assert linux.read_session(tmp_path) == session
    assert (tmp_path / 'session.json').stat().st_mode & 0o777 == 0o600
    linux.write_session(tmp_path, {**session, 'start_ticks': 'reused-pid'})
    assert linux.read_session(tmp_path) is None


def test_stale_session_cannot_signal_an_unrelated_process(tmp_path, monkeypatch):
    linux.write_session(tmp_path, {'pid': os.getpid(), 'start_ticks': 'old-process'})
    monkeypatch.setattr(linux.os, 'kill', lambda *_: pytest.fail('A stale session must not send a signal'))
    assert linux.stop(tmp_path, False) == 0


def test_dead_zombie_process_is_not_a_live_desktop_session(monkeypatch):
    monkeypatch.setattr(linux.Path, 'read_text', lambda *_: '123 (Frameinsight) ' + ' '.join(['Z'] + ['0'] * 18 + ['998877']))
    assert linux.process_start(123) is None


def test_second_server_exits_before_importing_or_changing_existing_data(tmp_path):
    state = tmp_path / 'state'; state.mkdir()
    with (state / 'server.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert linux.serve(tmp_path / 'must-not-be-created', state, 8765) == 0
    assert not (tmp_path / 'must-not-be-created').exists()


@pytest.mark.parametrize('original', [None, '/system/custom/lib'])
def test_system_desktop_programs_do_not_inherit_frozen_library_path(monkeypatch, original):
    monkeypatch.setenv('LD_LIBRARY_PATH', '/opt/frameinsight/_internal')
    if original is None: monkeypatch.delenv('LD_LIBRARY_PATH_ORIG', raising=False)
    else: monkeypatch.setenv('LD_LIBRARY_PATH_ORIG', original)
    calls = []
    monkeypatch.setattr(linux.subprocess, 'run', lambda command, **kwargs: calls.append((command, kwargs)))
    linux.desktop_command(['/usr/bin/xdg-open', 'http://127.0.0.1:8765/'])
    assert calls[0][1]['env'].get('LD_LIBRARY_PATH') == original
    assert 'LD_LIBRARY_PATH_ORIG' not in calls[0][1]['env']


def test_release_manifest_records_only_exact_platform_binaries(tmp_path):
    (tmp_path / 'Window_setup.exe').write_bytes(b'test Windows payload')
    (tmp_path / 'frameinsight_3.0.0_amd64.deb').write_bytes(b'test Debian payload')
    (tmp_path / 'unrelated.txt').write_text('Not an update package')
    (tmp_path / 'frameinsight-3.0.0-third-party-sources.tar.gz').write_bytes(b'source archive')
    result = release.write_manifest(tmp_path, '3.0.0')
    assert result['version'] == '3.0.0'
    assert [row['platform'] for row in result['assets']] == ['windows-x64', 'linux-amd64']
    for row in result['assets']:
        payload = (tmp_path / row['name']).read_bytes()
        assert row['sha256'] == hashlib.sha256(payload).hexdigest() and row['size'] == len(payload)
    checksums = (tmp_path / 'SHA256SUMS.txt').read_text()
    assert 'release-manifest.json' in checksums and 'unrelated.txt' not in checksums
    assert 'frameinsight-3.0.0-third-party-sources.tar.gz' in checksums


def test_release_manifest_refuses_missing_or_redirected_binary(tmp_path):
    with pytest.raises(ValueError, match='Missing release asset'):
        release.write_manifest(tmp_path, '3.0.0')
    original = tmp_path / 'original'; original.write_bytes(b'payload')
    (tmp_path / 'Window_setup.exe').symlink_to(original)
    with pytest.raises(ValueError, match='Missing release asset'):
        release.write_manifest(tmp_path, '3.0.0')


def test_release_version_fails_if_backend_or_lockfile_lags(tmp_path):
    (tmp_path / 'frontend/src').mkdir(parents=True)
    (tmp_path / 'backend/app').mkdir(parents=True)
    (tmp_path / 'frontend/package.json').write_text(json.dumps({'version': '3.0.0'}))
    (tmp_path / 'frontend/package-lock.json').write_text(json.dumps({'version': '3.0.0', 'packages': {'': {'version': '3.0.0'}}}))
    (tmp_path / 'frontend/src/release.ts').write_text("export const APP_VERSION = '3.0.0';")
    backend = tmp_path / 'backend/app/version.py'; backend.write_text("APP_VERSION = '3.0.0'")
    assert release.release_version(tmp_path) == '3.0.0'
    backend.write_text("APP_VERSION = '2.0.0'")
    with pytest.raises(ValueError, match='must match'): release.release_version(tmp_path)


def test_source_download_checks_checksum_before_replacing_cached_file(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / 'packaging'))
    sources = module('frameinsight_sources', 'packaging/third_party_sources.py')
    payload = b'correct corresponding sources'
    package = {'filename': 'library.tar.gz', 'url': 'https://example.invalid/library.tar.gz', 'sha256': hashlib.sha256(payload).hexdigest()}
    target = tmp_path / package['filename']; target.write_bytes(b'old file')
    monkeypatch.setattr(sources.urllib.request, 'urlopen', lambda *args, **kwargs: io.BytesIO(b'corrupt download'))
    monkeypatch.setattr(sources.time, 'sleep', lambda *_: None)
    with pytest.raises(RuntimeError, match='verified source'): sources.fetch(package, tmp_path)
    assert target.read_bytes() == b'old file' and not (tmp_path / 'library.tar.gz.part').exists()
    monkeypatch.setattr(sources.urllib.request, 'urlopen', lambda *args, **kwargs: io.BytesIO(payload))
    assert sources.fetch(package, tmp_path).read_bytes() == payload
