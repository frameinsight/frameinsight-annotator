"""Library dates reflect recorded work, never page visits or project creation."""
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.main import app


@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'library.sqlite3')
    db.init()
    with db.transaction() as connection:
        connection.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)', ('p', 'Library', '2001-01-01T00:00:00+00:00'))
        for vid in ('a', 'b'):
            video = {'id': vid, 'name': vid + '.mp4', 'status': 'ready', 'frame_count': 12, 'width': 640, 'height': 360}
            connection.execute('INSERT INTO videos VALUES(?,?,?)', (vid, 'p', json.dumps(video)))
    with TestClient(app) as client:
        yield client


def rows(client):
    response = client.get('/api/video-library')
    assert response.status_code == 200, response.text
    return {row['id']: row for row in response.json()}


def job(ident, vid, created_at, updated_at=None, kind='index'):
    value = {'id': ident, 'project_id': 'p', 'video_id': vid, 'kind': kind, 'status': 'completed', 'created_at': created_at}
    if updated_at:
        value['updated_at'] = updated_at
    with db.transaction() as connection:
        connection.execute('INSERT INTO jobs VALUES(?,?,?)', (ident, 'p', json.dumps(value)))


def operation(ident, created_at, changes, vid=None):
    value = {'id': ident, 'base_revision': 0, 'label': 'Edit', 'video_id': vid, 'changes': changes}
    with db.transaction() as connection:
        connection.execute('INSERT INTO operations VALUES(?,?,?,?,?)', (ident, 'p', 1, json.dumps(value), created_at))


def test_missing_video_dates_stay_unknown_and_library_reads_do_not_write(library, monkeypatch):
    with db.connect() as connection:
        before = [tuple(row) for row in connection.execute('SELECT * FROM videos ORDER BY id')]
    first = rows(library)
    assert all(row['created_at'] is None and row['updated_at'] is None for row in first.values())
    monkeypatch.setattr(db, 'now', lambda: '2099-01-01T00:00:00+00:00')
    assert rows(library) == first
    with db.connect() as connection:
        assert [tuple(row) for row in connection.execute('SELECT * FROM videos ORDER BY id')] == before


def test_dates_use_import_ledger_and_latest_video_edit_not_other_activity(library):
    job('import-a', 'a', '2026-09-01T01:00:00+00:00', '2026-09-01T01:02:00+00:00')
    job('retry-a', 'a', '2026-09-03T01:00:00+00:00', '2026-09-03T01:01:00+00:00')
    job('import-b', 'b', '2026-09-02T01:00:00+00:00', '2026-09-02T01:02:00+00:00')
    job('export-a', 'a', '2099-01-01T00:00:00+00:00', kind='export')
    job('preview-a', 'a', '2099-01-02T00:00:00+00:00', kind='review')
    operation('edit-a', '2026-09-04T05:00:00+05:00', [{'collection': 'observations', 'id': 'box', 'before': None, 'after': {'video_id': 'a'}}])
    operation('delete-b', '2026-09-05T00:00:00+00:00', [{'collection': 'observations', 'id': 'old', 'before': {'video_id': 'b'}, 'after': None}])
    result = rows(library)
    assert result['a']['created_at'] == '2026-09-01T01:00:00+00:00'
    assert result['a']['updated_at'] == '2026-09-04T00:00:00+00:00'
    assert result['b']['created_at'] == '2026-09-02T01:00:00+00:00'
    assert result['b']['updated_at'] == '2026-09-05T00:00:00+00:00'


def test_shared_identity_changes_update_each_related_video(library):
    with db.transaction() as connection:
        for vid in ('a', 'b'):
            value = {'id': 'segment-' + vid, 'video_id': vid, 'identity_uuid': 'shared'}
            connection.execute('INSERT INTO entities VALUES(?,?,?,?)', ('p', 'segments', value['id'], json.dumps(value)))
    operation('id-edit', '2026-09-10T12:00:00+00:00', [{'collection': 'identities', 'id': 'shared', 'before': {'person_id': 1}, 'after': {'person_id': 7}}], vid='a')
    result = rows(library)
    assert result['a']['updated_at'] == result['b']['updated_at'] == '2026-09-10T12:00:00+00:00'
    assert result['a']['created_at'] is None and result['b']['created_at'] is None


def test_project_metadata_and_successful_finish_count_as_updates(library):
    with db.transaction() as connection:
        connection.execute('INSERT INTO project_settings_events VALUES(?,?,?,?,?,?)', ('settings', 'p', 1, '{}', '{}', '2026-09-12T00:00:00+00:00'))
        connection.execute('INSERT INTO validations VALUES(?,?,?,?,?,?)', ('validation-a', 'p', 'a', 1, '', json.dumps({'passed': True, 'created_at': '2026-09-13T00:00:00+00:00'})))
        connection.execute('INSERT INTO validations VALUES(?,?,?,?,?,?)', ('failed-b', 'p', 'b', 1, '', json.dumps({'passed': False, 'created_at': '2099-01-01T00:00:00+00:00'})))
    result = rows(library)
    assert result['a']['updated_at'] == '2026-09-13T00:00:00+00:00'
    assert result['b']['updated_at'] == '2026-09-12T00:00:00+00:00'
    assert all(row['created_at'] is None for row in result.values())


def test_saved_video_dates_take_precedence_over_reindex_creation(library):
    db.update_video('a', created_at='2026-08-01T00:00:00Z', updated_at='2026-09-20T12:00:00+05:00')
    db.update_video('b', created_at='unknown', imported_at='2026-09-01', updated_at='not a date')
    job('reindex-a', 'a', '2026-09-10T00:00:00+00:00')
    result = rows(library)
    assert result['a']['created_at'] == '2026-08-01T00:00:00+00:00'
    assert result['a']['updated_at'] == '2026-09-20T07:00:00+00:00'
    assert result['b']['created_at'] is None and result['b']['updated_at'] is None
