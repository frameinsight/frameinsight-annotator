"""Annotation-only validation freezes JSON and never renders or rereads video."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import db, formats, review_delivery as delivery
from backend.app.annotation_export import annotation_document
from backend.app.main import app
from backend.app.project_settings import ProjectSettings, update_settings
from backend.app.review_validation import validate_document
from backend.app.video import new_job
from test_review_delivery import reviewed_project, edit_identity


def validate(pid, vid, coverage='selected_people'):
    revision = db.snapshot(pid)['revision']
    report = delivery.validate_annotations(vid, revision, True, coverage)
    return report, {'format': 'annotations_json', 'video_id': vid, 'revision': revision, 'validation_id': report['validation_id'], 'include_videos': False}


def test_validate_and_export_without_review_media_or_source_file(reviewed_project, monkeypatch):
    pid, vid, *_ = reviewed_project
    Path(db.snapshot(pid)['videos'][vid]['source']).unlink()
    def forbidden(*args, **kwargs):
        raise AssertionError('Annotation validation must not decode, render or hash source media')
    monkeypatch.setattr(delivery, 'verify_source', forbidden)
    monkeypatch.setattr(delivery, 'render_review', forbidden)
    monkeypatch.setattr(delivery.av, 'open', forbidden)
    with TestClient(app) as client:
        response = client.post(f'/api/videos/{vid}/validate', json={'revision': 0, 'visual_confirmed': True, 'coverage': 'selected_people'})
        assert response.status_code == 200, response.text
        report = response.json()
        assert report['passed'] and report['mode'] == 'structural'
        assert 'review_job_id' not in report and 'review_video_hash' not in report
        assert not any('render' in check['name'].lower() for check in report['checks'])
        settings = {'format': 'annotations_json', 'video_id': vid, 'revision': 0, 'validation_id': report['validation_id'], 'include_videos': False}
        finish = client.post(f'/api/videos/{vid}/finish', json={'revision': 0, 'confirmed': True, 'validation_id': report['validation_id']})
        assert finish.status_code == 200, finish.text
        assert next(v for v in client.get('/api/video-library').json() if v['id'] == vid)['finished']
        job = new_job(pid, 'export')
        formats.export_project(pid, settings, job['id'])
        completed = db.job_get(job['id'])
        assert completed['status'] == 'completed', completed
        response = client.get('/api/exports/' + completed['export_id'])
        assert response.status_code == 200, response.text
        exported = response.json()
        assert exported['media_included'] is False and exported['validation']['mode'] == 'structural'
        assert exported['state'] == db.snapshot(pid)['state']
        assert not (delivery.DATA / 'reviews').exists()
        with db.connect() as connection:
            assert not any(json.loads(row['data']).get('kind') == 'review' for row in connection.execute('SELECT data FROM jobs WHERE project_id=?', (pid,)))


def test_structural_validation_does_not_judge_bounds_containment_or_real_identity(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    # The document is internally consistent. Where boxes should sit and whether
    # an identity is visually resolved are outside this validation's purpose.
    with db.transaction() as connection:
        for row in connection.execute("SELECT id,data FROM entities WHERE project_id=? AND collection='observations'", (pid,)).fetchall():
            observation = json.loads(row['data'])
            observation.update(person_visible=[-10, -20, 300, 240], person_ext=[20, 20, 30, 30], review_state='approved')
            connection.execute('UPDATE entities SET data=? WHERE project_id=? AND collection=? AND id=?', (json.dumps(observation), pid, 'observations', row['id']))
        for row in connection.execute("SELECT id,data FROM entities WHERE project_id=? AND collection='segments'", (pid,)).fetchall():
            segment = json.loads(row['data']); segment['status'] = 'unresolved'
            connection.execute('UPDATE entities SET data=? WHERE project_id=? AND collection=? AND id=?', (json.dumps(segment), pid, 'segments', row['id']))
    document = annotation_document(pid, vid)
    report = validate_document(document)
    assert report['passed'], report
    assert report['warnings'] == []
    report, settings = validate(pid, vid)
    assert report['passed']
    assert delivery.validated_document(pid, settings)['state'] == document['state']


@pytest.mark.parametrize('box', [[1, 2], ['bad', 1, 5, 6], [1, 1, 1, 1], [10, 5, 1, 6], [float('nan'), 1, 5, 6]])
def test_malformed_rectangles_still_fail_structural_validation(reviewed_project, box):
    pid, vid, *_ = reviewed_project
    document = annotation_document(pid, vid)
    next(iter(document['state']['observations'].values()))['person_visible'] = box
    assert not validate_document(document)['passed']


def test_structural_proof_rejects_edits_renames_catalog_changes_and_tampered_json(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    report, settings = validate(pid, vid)
    saved = Path(report['snapshot_path']).read_bytes()
    Path(report['snapshot_path']).write_text('{}')
    with pytest.raises(ValueError, match='snapshot has changed'):
        delivery.validation_proof(pid, settings)
    Path(report['snapshot_path']).write_bytes(saved)
    edit_identity(pid, ident)
    with pytest.raises(db.Conflict):
        delivery.validation_proof(pid, settings)
    report, settings = validate(pid, vid)
    project = db.snapshot(pid)
    update_settings(pid, ProjectSettings(base_revision=project['revision'], name='New project name', class_renames={'person_visible': 'Person'}))
    with pytest.raises(db.Conflict):
        delivery.validation_proof(pid, settings)
    report, settings = validate(pid, vid)
    with db.transaction() as connection:
        connection.execute('UPDATE projects SET classes=? WHERE id=?', (json.dumps(['Person', 'person_extended', 'New class']), pid))
    with pytest.raises(ValueError, match='stale'):
        delivery.validation_proof(pid, settings)


def test_structural_validation_race_does_not_issue_proof(reviewed_project, monkeypatch):
    pid, vid, ident, _ = reviewed_project
    original = delivery.validate_document
    def racing_validation(document):
        report = original(document)
        edit_identity(pid, ident)
        return report
    monkeypatch.setattr(delivery, 'validate_document', racing_validation)
    with pytest.raises(db.Conflict):
        validate(pid, vid)
    with db.connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM validations WHERE project_id=?', (pid,)).fetchone()[0] == 0
    assert 'finished_revision' not in db.snapshot(pid)['videos'][vid]
    assert not list((delivery.DATA / 'validations').glob('*/annotations.json'))


def test_structural_export_race_does_not_publish_stale_json(reviewed_project, monkeypatch):
    pid, vid, ident, _ = reviewed_project
    _, settings = validate(pid, vid)
    original = Path.write_text
    def racing_write(path, *args, **kwargs):
        result = original(path, *args, **kwargs)
        if path.parent == delivery.DATA / 'exports' and path.suffix == '.json':
            edit_identity(pid, ident)
        return result
    monkeypatch.setattr(Path, 'write_text', racing_write)
    job = new_job(pid, 'export')
    formats.export_project(pid, settings, job['id'])
    assert db.job_get(job['id'])['status'] == 'failed'
    with db.connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM exports WHERE project_id=?', (pid,)).fetchone()[0] == 0
    assert not list((delivery.DATA / 'exports').glob('*.json'))


def test_failed_structural_validation_cannot_export(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    with db.transaction() as connection:
        identity = db.get_state(connection, pid)['state']['identities'][ident]
        identity['person_id'] = None
        connection.execute("UPDATE entities SET data=? WHERE project_id=? AND collection='identities' AND id=?", (json.dumps(identity), pid, ident))
    report, settings = validate(pid, vid)
    assert not report['passed']
    assert 'missing_person_id' in {error['code'] for error in report['errors']}
    assert 'snapshot_path' not in report and 'finished_revision' not in db.snapshot(pid)['videos'][vid]
    with pytest.raises(ValueError, match='does not match'):
        delivery.validation_proof(pid, settings)


def test_document_schema_catalog_and_unused_class_references_are_checked(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    for key, value in [('format', 'other'), ('schema_version', 999), ('classes', ['Person', 'Person'])]:
        document = annotation_document(pid, vid)
        document[key] = value
        assert not validate_document(document)['passed']
    document = annotation_document(pid, vid)
    document['state']['identities'][ident]['box_styles']['class:Unknown'] = {'class_name': 'Unknown', 'color': '#22d3ee'}
    assert 'unknown_class' in {error['code'] for error in validate_document(document)['errors']}


def test_empty_negative_annotation_document_passes_without_semantic_warnings(reviewed_project):
    pid, vid, *_ = reviewed_project
    with db.transaction() as connection:
        connection.execute('DELETE FROM entities WHERE project_id=?', (pid,))
    document = annotation_document(pid, vid)
    report = validate_document(document)
    assert report['passed'] and report['warnings'] == []
    assert report['summary']['people'] == report['summary']['boxes'] == 0
    assert report['summary']['frames'] == db.snapshot(pid)['videos'][vid]['frame_count']
    assert report['summary']['warning_occurrences'] == report['summary']['warning_groups'] == 0


def test_structural_api_requires_confirmation_and_valid_coverage(reviewed_project):
    _, vid, *_ = reviewed_project
    with TestClient(app) as client:
        for body in ({'revision': 0, 'visual_confirmed': False, 'coverage': 'selected_people'}, {'revision': 0, 'visual_confirmed': True, 'coverage': 'unknown'}):
            assert client.post(f'/api/videos/{vid}/validate', json=body).status_code == 422
