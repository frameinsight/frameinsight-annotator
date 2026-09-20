"""Saved AI-origin annotations remain ordinary editable data after removing AI UI."""
import copy
import json
import uuid

from fastapi.testclient import TestClient

from backend.app import db
from backend.app.annotation_export import annotation_document
from backend.app.main import app
from backend.app.schema import Observation, validate_state
from test_domain import project, seeded


def test_legacy_model_track_load_export_manual_edit_and_exact_undo(project):
    p, video_id, identity_id, segment_id, observation_id = seeded(project)
    original = p['state']['observations'][observation_id]
    original['provenance'] = {
        'person_visible': {'origin': 'model_track', 'proposal_id': 'historical-proposal', 'human_corrected': False},
        'person_ext': {'origin': 'manual', 'proposal_id': None, 'human_corrected': True},
    }
    assert Observation.model_validate_json(json.dumps(original)).provenance['person_visible'].origin == 'model_track'
    validate_state(p['state'], p['videos'], visible_only=True)
    with db.transaction() as connection:
        for collection, entities in p['state'].items():
            for key, value in entities.items():
                connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (p['id'], collection, key, json.dumps(value)))

    document = annotation_document(p['id'], video_id)
    visible = next(row for row in document['annotation_index'] if row['geometry_name'] == 'person_visible')
    assert document['state'] == p['state']
    assert document['media_included'] is False
    assert visible['origin'] == 'model_track' and not visible['human_corrected']
    assert not visible['protected_from_interpolation']

    corrected = copy.deepcopy(original)
    corrected['person_visible'] = [22, 20, 90, 105]
    corrected['provenance']['person_visible']['human_corrected'] = True
    operation = {
        'id': str(uuid.uuid4()), 'base_revision': 0, 'label': 'Manually correct an older saved box',
        'video_id': video_id, 'frame_index': original['frame_index'],
        'changes': [{'collection': 'observations', 'id': observation_id, 'before': original, 'after': corrected}],
    }
    # The fixture initializes SQLite directly. Do not run global startup recovery
    # against unrelated synthetic videos left by other tests in this process.
    client = TestClient(app)
    try:
        response = client.post(f"/api/projects/{p['id']}/operations", json=operation)
        assert response.status_code == 200, response.text
        saved = client.get(f"/api/projects/{p['id']}").json()
        assert saved['state']['observations'][observation_id] == corrected
        assert saved['state']['observations'][observation_id]['person_ext'] == original['person_ext']
        assert saved['state']['identities'][identity_id] == p['state']['identities'][identity_id]
        edited_export = annotation_document(p['id'], video_id)
        edited_visible = next(row for row in edited_export['annotation_index'] if row['geometry_name'] == 'person_visible')
        assert edited_visible['origin'] == 'model_track'
        assert edited_visible['human_corrected'] and edited_visible['protected_from_interpolation']

        undo = {
            'id': str(uuid.uuid4()), 'base_revision': 1, 'label': 'Undo manual correction', 'compensates': operation['id'],
            'changes': [{'collection': 'observations', 'id': observation_id, 'before': corrected, 'after': original}],
        }
        response = client.post(f"/api/projects/{p['id']}/operations", json=undo)
        assert response.status_code == 200, response.text
        restored = client.get(f"/api/projects/{p['id']}").json()
        assert restored['state'] == p['state']
        validate_state(restored['state'], restored['videos'], visible_only=True)
        assert annotation_document(p['id'], video_id)['state'] == p['state']
    finally:
        client.close()
