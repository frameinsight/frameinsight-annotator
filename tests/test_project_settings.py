"""Project/class metadata updates preserve geometry, recovery and delivery safety."""
import copy
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app import db, review_delivery as review
from backend.app.annotation_export import annotation_document
from backend.app.main import app
from backend.app.project_settings import ProjectSettings, update_settings
from backend.app.schema import MODELS, Operation
from test_domain import project, seeded
from test_review_delivery import reviewed_project, proof


@pytest.fixture(autouse=True)
def isolated_settings_database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'settings.sqlite3')


def request(project, **values):
    return ProjectSettings(base_revision=project['revision'], name=project['name'], **values)


@pytest.fixture
def named_project(project):
    p, vid, ident, segment, obs = seeded(project)
    p['classes'] = ['Person', 'Extended']
    person = p['state']['identities'][ident]
    person.update(class_name='Person', box_styles={
        'class:Person': {'class_name': 'Person', 'color': '#22d3ee'},
        'class:Extended': {'class_name': 'Extended', 'color': '#fbbf24'},
    })
    observation = p['state']['observations'][obs]
    observation.update(person_visible=None, person_ext=None, boxes={
        'class:Person': [20, 20, 90, 100], 'class:Extended': [10, 10, 100, 200],
    }, provenance={'class:Person': {'origin': 'manual', 'proposal_id': None, 'human_corrected': False}})
    gap = MODELS['intervals'](id='gap', video_id=vid, identity_uuid=ident, geometry='class:Extended', start=100, end=110, reason='unknown').model_dump()
    p['state']['intervals'][gap['id']] = gap
    with db.transaction() as connection:
        connection.execute('UPDATE projects SET classes=?,class_colors=? WHERE id=?', (json.dumps(p['classes']), json.dumps({'Person': '#22d3ee', 'Extended': '#fbbf24'}), p['id']))
    operation = Operation(id=str(uuid.uuid4()), base_revision=0, label='Create boxes and hidden interval', changes=[{'collection': collection, 'id': ident, 'before': None, 'after': value} for collection, values in p['state'].items() for ident, value in values.items()])
    db.apply(p['id'], operation)
    return db.snapshot(p['id']), vid, ident, obs, operation


def test_atomic_class_swap_preserves_ids_boxes_gaps_colors_and_recovery_history(named_project):
    p, vid, ident, obs, operation = named_project
    before = copy.deepcopy(p['state']['observations'][obs])
    result = update_settings(p['id'], ProjectSettings(base_revision=p['revision'], name='People dataset', class_renames={'Person': 'Extended', 'Extended': 'Person'}))
    assert result['name'] == 'People dataset' and result['revision'] == p['revision'] + 1
    assert result['classes'] == ['Extended', 'Person']
    assert result['class_colors'] == {'Extended': '#22d3ee', 'Person': '#fbbf24'}
    person = result['state']['identities'][ident]
    assert person['person_id'] == 17 and person['class_name'] == 'Extended'
    assert person['box_styles']['class:Extended']['class_name'] == 'Extended'
    after = result['state']['observations'][obs]
    assert after['identity_uuid'] == ident and after['id'] == obs
    assert after['boxes'] == {'class:Extended': before['boxes']['class:Person'], 'class:Person': before['boxes']['class:Extended']}
    assert after['provenance'] == {'class:Extended': before['provenance']['class:Person']}
    assert result['state']['intervals']['gap']['geometry'] == 'class:Person'
    with db.connect() as connection:
        recovered = json.loads(connection.execute('SELECT data FROM operations WHERE id=?', (operation.id,)).fetchone()['data'])
    saved_box = next(change['after'] for change in recovered['changes'] if change['id'] == obs)
    assert saved_box == after
    # Server-translated undo remains exact and cannot recreate old class keys.
    db.apply(p['id'], Operation(id=str(uuid.uuid4()), base_revision=result['revision'], label='Undo boxes after rename', compensates=operation.id, changes=[{**change, 'before': change['after'], 'after': change['before']} for change in recovered['changes']]))
    assert not db.snapshot(p['id'])['state']['observations']


def test_deleted_box_recovery_nested_restored_history_and_export_names(named_project):
    p, vid, ident, obs, operation = named_project
    old = p['state']['observations'][obs]
    delete = Operation(id=str(uuid.uuid4()), base_revision=p['revision'], label='Delete boxes', changes=[{'collection': 'observations', 'id': obs, 'before': old, 'after': None}])
    db.apply(p['id'], delete)
    with db.transaction() as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS restored_history(project_id TEXT PRIMARY KEY,data TEXT NOT NULL)')
        connection.execute('INSERT INTO restored_history VALUES(?,?)', (p['id'], json.dumps({'operations': [delete.model_dump(mode='json')], 'previous_restored_history': {'operations': [operation.model_dump(mode='json')]}})))
    current = db.snapshot(p['id'])
    result = update_settings(p['id'], request(current, class_renames={'Person': 'Pedestrian', 'Extended': 'Full body'}))
    doc = annotation_document(p['id'])
    assert doc['classes'] == ['Pedestrian', 'Full body']
    assert doc['project_settings_history'][0]['class_renames'] == {'Person': 'Pedestrian', 'Extended': 'Full body'}
    recovered_delete = next(op for op in doc['operations'] if op['id'] == delete.id)
    recovered = recovered_delete['changes'][0]['before']
    assert set(recovered['boxes']) == {'class:Pedestrian', 'class:Full body'}
    assert doc['restored_history']['operations'][0]['changes'][0]['before'] == recovered
    assert 'class:Person' not in json.dumps(doc['restored_history'])
    db.apply(p['id'], Operation(id=str(uuid.uuid4()), base_revision=result['revision'], label='Recover original deleted boxes', changes=[{'collection': 'observations', 'id': obs, 'before': None, 'after': recovered}]))
    exported = annotation_document(p['id'], vid)
    assert {row['class_name'] for row in exported['annotation_index']} == {'Pedestrian', 'Full body'}
    assert {row['track_id'] for row in exported['annotation_index']} == {17}
    assert {row['class_key'] for row in exported['presence_intervals']} == {'class:Pedestrian', 'class:Full body'}


def test_legacy_implicit_styles_rename_without_rekeying_legacy_coordinates(project):
    p, vid, ident, segment, obs = seeded(project)
    p['state']['identities'][ident].pop('box_styles')
    original_box = copy.deepcopy(p['state']['observations'][obs])
    with db.transaction() as connection:
        connection.execute('UPDATE projects SET classes=? WHERE id=?', (json.dumps(['person_visible', 'person_extended']), p['id']))
        for collection, values in p['state'].items():
            for key, value in values.items():
                connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (p['id'], collection, key, json.dumps(value)))
    result = update_settings(p['id'], request(p, class_renames={'person_visible': 'Visible person', 'person_extended': 'Full person'}))
    assert result['state']['observations'][obs] == original_box
    styles = result['state']['identities'][ident]['box_styles']
    assert styles['person_visible']['class_name'] == 'Visible person'
    assert styles['person_ext']['class_name'] == 'Full person'
    exported = annotation_document(p['id'], vid)
    assert {row['class_name'] for row in exported['annotation_index']} == {'Visible person', 'Full person'}


def test_legacy_extended_only_alias_keeps_its_class_and_color_after_rename(project):
    p, vid, ident, segment, obs = seeded(project)
    person = p['state']['identities'][ident]
    person.update(class_name='person_exteded', color='#22d3ee', box_styles={})
    p['state']['observations'][obs]['person_visible'] = None
    with db.transaction() as connection:
        connection.execute('UPDATE projects SET classes=? WHERE id=?', (json.dumps(['person_exteded']), p['id']))
        for collection, values in p['state'].items():
            for key, value in values.items():
                connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (p['id'], collection, key, json.dumps(value)))
    result = update_settings(p['id'], request(p, class_renames={'person_exteded': 'Full person'}))
    assert result['state']['identities'][ident]['box_styles']['person_ext'] == {'class_name': 'Full person', 'color': '#22d3ee'}
    assert annotation_document(p['id'], vid)['annotation_index'][0]['class_name'] == 'Full person'


@pytest.mark.parametrize('renames', [{'Person': 'Extended'}, {'Unknown': 'A'}, {'Person': 'Same', 'Extended': 'Same'}])
def test_collision_and_unknown_source_roll_back_all_settings(named_project, renames):
    p, *_ = named_project
    with pytest.raises(ValueError):
        update_settings(p['id'], ProjectSettings(base_revision=p['revision'], name='Must not be saved', class_renames=renames))
    assert db.snapshot(p['id']) == p


@pytest.mark.parametrize('patch', [{'name': '   '}, {'name': 'bad\nname'}, {'class_renames': {'Person': ''}}, {'class_renames': {'Person': 'x' * 81}}, {'new_classes': ['Head', ' Head ']}, {'unexpected': True}])
def test_api_rejects_invalid_names_and_fields(named_project, patch):
    p, *_ = named_project
    with TestClient(app) as client:
        result = client.patch('/api/projects/' + p['id'] + '/settings', json={'base_revision': p['revision'], 'name': p['name'], **patch})
        assert result.status_code == 422, result.text
    assert db.snapshot(p['id']) == p


def test_api_concurrent_revision_idempotency_and_atomic_new_classes(named_project):
    p, *_ = named_project
    payload = {'base_revision': p['revision'], 'name': 'Renamed', 'class_renames': {'Person': 'Pedestrian'}, 'new_classes': ['Head'], 'request_id': str(uuid.uuid4())}
    with TestClient(app) as client:
        saved = client.patch('/api/projects/' + p['id'] + '/settings', json=payload)
        assert saved.status_code == 200, saved.text
        assert saved.json()['classes'] == ['Pedestrian', 'Extended', 'Head']
        assert saved.json()['class_colors']['Head'] in db.NEW_BOX_COLORS
        assert client.patch('/api/projects/' + p['id'] + '/settings', json=payload).json() == saved.json()
        stale = client.patch('/api/projects/' + p['id'] + '/settings', json={**payload, 'request_id': str(uuid.uuid4())})
        assert stale.status_code == 409 and stale.json()['revision'] == p['revision'] + 1
        assert client.patch('/api/projects/' + p['id'] + '/settings', json={**payload, 'name': 'Reused request'}).status_code == 422
    assert db.snapshot(p['id'])['name'] == 'Renamed'


def test_rename_after_finished_review_invalidates_old_delivery_proof(reviewed_project):
    pid, vid, *_ = reviewed_project
    job, report, old_settings = proof(pid, vid)
    project = db.snapshot(pid)
    updated = update_settings(pid, ProjectSettings(base_revision=project['revision'], name='Final dataset', class_renames={'person_visible': 'Person'}))
    assert 'finished_revision' not in updated['videos'][vid]
    assert not review.current_matches(job)
    with pytest.raises(db.Conflict):
        review.validation_proof(pid, old_settings)
    new_job, new_report, new_settings = proof(pid, vid)
    assert new_report['passed'] and new_settings['revision'] == updated['revision']
    review.validation_proof(pid, new_settings)
    exported = review.read_document(new_job)
    assert exported['project']['name'] == 'Final dataset'
    assert 'Person' in {row['class_name'] for row in exported['annotation_index']}


def test_noop_keeps_revision_and_review_valid(reviewed_project):
    pid, vid, *_ = reviewed_project
    job, *_ = proof(pid, vid)
    project = db.snapshot(pid)
    result = update_settings(pid, request(project, class_renames={'person_visible': 'person_visible'}))
    assert result == project and review.current_matches(job)
