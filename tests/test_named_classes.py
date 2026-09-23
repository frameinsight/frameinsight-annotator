"""Named channels share one identity and never rewrite the legacy undo ledger."""
import copy
import json
import uuid
import zipfile
from pathlib import Path

import pytest
from backend.app import db, formats, review_delivery as review
from backend.app.annotation_export import annotation_document
from backend.app.geometry import box_items, get_box, box_style
from backend.app.review_validation import validate_document
from backend.app.schema import MODELS, Operation, validate_state
from backend.app.visibility import presence_intervals
from backend.app.video import new_job
from test_domain import project, seeded
from test_review_delivery import reviewed_project, completed_review, proof


NAMES = ['Vehicle', 'Plate', 'Driver']
COLORS = ['#ff7733', '#33ddff', '#dd55ff']


def make_named(pid, ident):
    snapshot = db.snapshot(pid)
    changes = []
    old = snapshot['state']['identities'][ident]
    after = {**old, 'box_styles': {'class:' + name: {'class_name': name, 'color': color} for name, color in zip(NAMES, COLORS)}}
    changes.append({'collection': 'identities', 'id': ident, 'before': old, 'after': after})
    for key, old in snapshot['state']['observations'].items():
        after = {**old, 'person_visible': None, 'person_ext': None,
                 'boxes': {'class:Vehicle': [5, 10, 120, 115], 'class:Plate': [15, 90, 45, 110], 'class:Driver': [50, 20, 100, 75]},
                 'provenance': {key: {'origin': 'manual'} for key in ('class:Vehicle', 'class:Plate', 'class:Driver')}}
        changes.append({'collection': 'observations', 'id': key, 'before': old, 'after': after})
    with db.transaction() as connection:
        connection.execute('UPDATE projects SET classes=? WHERE id=?', (json.dumps(NAMES), pid))
    db.apply(pid, Operation(id=str(uuid.uuid4()), base_revision=snapshot['revision'], label='Three named classes', changes=changes))


def test_three_classes_shared_track_render_validate_and_export(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    make_named(pid, ident)
    doc = annotation_document(pid, vid)
    assert doc['schema_version'] == 3 and doc['app_version'] == review.APP_VERSION
    assert doc['summary']['boxes'] == 18 and doc['summary']['boxes_by_class'] == {'class:Driver': 6, 'class:Plate': 6, 'class:Vehicle': 6}
    assert {row['track_id'] for row in doc['annotation_index']} == {1}
    assert {row['identity_uuid'] for row in doc['annotation_index']} == {ident}
    assert len(doc['frame_annotations']) == 6 and all(len(row['boxes']) == 3 for row in doc['frame_annotations'])
    assert all(row['presence'] == 'present' and row['visibility'] is None for row in doc['annotation_index'])
    report = validate_document(doc)
    assert report['passed'], report
    job = review.create_review(vid, 1)
    assert db.job_get(job['id'])['status'] == 'completed', db.job_get(job['id'])
    report = review.validate_review(vid, 1, job['id'], True, 'selected_people')
    settings = {'format': 'annotations_json', 'video_id': vid, 'revision': 1, 'validation_id': report['validation_id'], 'review_job_id': job['id']}
    export = new_job(pid, 'export');formats.export_project(pid, settings, export['id'])
    assert db.job_get(export['id'])['status'] == 'completed'
    with db.connect() as connection:
        path = json.loads(connection.execute('SELECT data FROM exports WHERE id=?', (db.job_get(export['id'])['export_id'],)).fetchone()['data'])['path']
    delivered = json.loads(Path(path).read_text())
    assert delivered['state'] == db.snapshot(pid)['state']
    assert delivered['summary']['boxes'] == 18 and not delivered['media_included']


def test_legacy_observation_shape_and_compensation_stay_exact(project):
    p, vid, ident, seg, obs = seeded(project)
    old = p['state']['observations'][obs]
    old.pop('boxes', None)  # Exact pre-v3 saved observation: no new field.
    with db.transaction() as connection:
        for collection, values in p['state'].items():
            for key, value in values.items():
                connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (p['id'], collection, key, json.dumps(value)))
    before = copy.deepcopy(old)
    after = {**before, 'person_visible': [21, 20, 90, 100]}
    op = Operation(id=str(uuid.uuid4()), base_revision=0, label='Legacy edit', changes=[{'collection':'observations','id':obs,'before':before,'after':after}])
    db.apply(p['id'], op)
    assert db.snapshot(p['id'])['state']['observations'][obs] == after
    assert 'boxes' not in db.snapshot(p['id'])['state']['observations'][obs]
    db.apply(p['id'], Operation(id=str(uuid.uuid4()), base_revision=1, compensates=op.id, label='Undo legacy', changes=[{'collection':'observations','id':obs,'before':after,'after':before}]))
    assert db.snapshot(p['id'])['state']['observations'][obs] == before
    document = annotation_document(p['id'])
    assert document['operations'][0]['changes'][0]['before'] == before
    assert document['operations'][0]['changes'][0]['after'] == after


@pytest.mark.parametrize('key', ['person_visible', 'person_ext', 'class:', 'class: spaced ', 'Vehicle', 'class:' + 'x' * 81])
def test_reserved_or_malformed_channel_keys_rejected(key):
    with pytest.raises(ValueError):
        MODELS['observations'](id='o',video_id='v',frame_index=0,identity_uuid='i',segment_id='s',boxes={key:[1,2,30,40]})


def test_gap_removes_only_selected_class_and_presence_is_not_occlusion(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    make_named(pid, ident)
    p = db.snapshot(pid); state = p['state']
    first = next(o for o in state['observations'].values() if o['frame_index'] == 2)
    del first['boxes']['class:Plate']
    state['intervals']['gap'] = MODELS['intervals'](id='gap', video_id=vid, identity_uuid=ident, geometry='class:Plate', start=2, end=2, reason='unknown').model_dump()
    validate_state(state, p['videos'], visible_only=True)
    runs = presence_intervals(state, p['videos'])
    absent = [r for r in runs if r['status'] == 'absent']
    assert len(absent) == 1 and absent[0]['class_key'] == 'class:Plate'
    assert absent[0]['start'] == absent[0]['end'] == 2 and absent[0]['reason'] == 'unknown'
    assert all(r['status'] == 'present' for r in runs if r['class_key'] == 'class:Vehicle')
    first['boxes']['class:Plate'] = [15, 90, 45, 110]
    with pytest.raises(ValueError, match='gap'):
        validate_state(state, p['videos'], visible_only=True)


def test_named_class_index_identity_and_presence_tampering_detected(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    make_named(pid, ident)
    for field, value in [('class_key','class:Wrong'),('track_id',99),('class_name','Wrong'),('color','#ffffff'),('origin','copied')]:
        doc = annotation_document(pid, vid);doc['annotation_index'][0][field] = value
        assert not validate_document(doc)['passed']
    doc = annotation_document(pid, vid);doc['presence_intervals'][0]['status'] = 'absent'
    assert 'presence_intervals' in {e['code'] for e in validate_document(doc)['errors']}
    doc = annotation_document(pid, vid);doc['classes'].remove('Vehicle')
    assert 'unknown_class' in {e['code'] for e in validate_document(doc)['errors']}
    doc = annotation_document(pid, vid);doc['annotation_index'].append(doc['annotation_index'][0])
    assert not validate_document(doc)['passed']


def test_legacy_dataset_formats_refuse_to_drop_named_boxes(reviewed_project):
    pid, vid, ident, _ = reviewed_project
    make_named(pid, ident)
    p = db.snapshot(pid)
    with pytest.raises(ValueError, match='named class'):
        formats.cvat_xml(p, vid)
    with pytest.raises(ValueError, match='named class'):
        formats.yolo_rows(list(p['state']['observations'].values()),160,120,'visible_only')
    for profile in ('cvat', 'visible_only', 'mot'):
        job = new_job(pid, 'export');formats.export_project(pid, {'format': profile}, job['id'])
        assert db.job_get(job['id'])['status'] == 'failed'
        assert 'named class' in db.job_get(job['id'])['error']
    job = new_job(pid, 'export');formats.export_project(pid, {'format': 'native'}, job['id'])
    assert db.job_get(job['id'])['status'] == 'completed'
    with db.connect() as connection:
        path = json.loads(connection.execute('SELECT data FROM exports WHERE id=?', (db.job_get(job['id'])['export_id'],)).fetchone()['data'])['path']
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('native/project.json'))
    assert manifest['schema_version'] == 2
    assert manifest['state'] == p['state']


def test_previous_version_review_cannot_be_reused_as_v3_proof(reviewed_project):
    pid, vid, _, _ = reviewed_project
    job, report, settings = proof(pid, vid)
    db.job_update(job['id'], app_version='2.0.0')
    assert review.review_metadata(job['id'])['stale']
    with pytest.raises(ValueError, match='stale'):
        review.validate_review(vid, 0, job['id'], True, 'selected_people')
    with pytest.raises(ValueError, match='stale'):
        review.validation_proof(pid, settings)


@pytest.mark.parametrize('schema_version', [1, 2])
def test_native_restore_keeps_old_shape_and_named_class_channels(tmp_path, schema_version):
    from test_video_restore import setup_video
    from backend.app.restore import restore_archive
    pid, vid = setup_video(tmp_path)
    ident, segment, observation = [str(uuid.uuid4()) for _ in range(3)]
    identity = MODELS['identities'](id=ident, person_id=12).model_dump(mode='json')
    seg = MODELS['segments'](id=segment, video_id=vid, identity_uuid=ident, start=0).model_dump(mode='json')
    obs = MODELS['observations'](id=observation,video_id=vid,frame_index=0,identity_uuid=ident,segment_id=segment,person_visible=[5,5,60,70]).model_dump(mode='json')
    obs.pop('boxes')
    if schema_version == 2:
        obs['boxes'] = {'class:Vehicle': [2, 3, 100, 85], 'class:Plate': [20, 50, 40, 70], 'class:Driver': [50, 10, 80, 40]}
    with db.transaction() as connection:
        connection.execute('UPDATE projects SET classes=? WHERE id=?', (json.dumps(NAMES), pid))
        for collection, value in [('identities', identity), ('segments', seg), ('observations', obs)]:
            connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, collection, value['id'], json.dumps(value)))
    job = new_job(pid, 'export');formats.export_project(pid, {'format':'native','include_videos':True}, job['id'])
    with db.connect() as connection:
        source = json.loads(connection.execute('SELECT data FROM exports WHERE id=?', (db.job_get(job['id'])['export_id'],)).fetchone()['data'])['path']
    archive_path = tmp_path / f'native-v{schema_version}.zip'
    with zipfile.ZipFile(source) as source_zip, zipfile.ZipFile(archive_path, 'w') as destination:
        for member in source_zip.infolist():
            content = source_zip.read(member)
            if member.filename == 'native/project.json':
                manifest = json.loads(content);manifest['schema_version'] = schema_version
                content = json.dumps(manifest).encode()
            destination.writestr(member.filename, content)
    job = new_job('native-import', 'restore');restore_archive(archive_path, job['id'])
    restored = db.job_get(job['id'])
    assert restored['status'] == 'completed', restored
    actual = db.snapshot(restored['restored_project_id'])['state']['observations'][observation]
    assert actual == {**obs, 'video_id': actual['video_id']}
    assert ('boxes' in actual) == (schema_version == 2)


def test_legacy_color_fallback_does_not_change_with_project_palette():
    identity = {'class_name': 'Worker', 'color': '#123456'}
    assert box_style(identity, 'person_visible', {'Worker': '#abcdef'})['color'] == '#123456'
    assert box_style(identity, 'person_ext', {'person_extended': '#abcdef'})['color'] == '#67e2b1'


@pytest.mark.parametrize('origin,corrected,approved,kind,protected', [
    ('copied_track',False,False,'generated',False),
    ('copied_track',True,False,'keyframe',True),
    ('copied_track',False,True,'generated',True),
    ('model_track',False,False,'generated',False),
    ('interpolated',False,False,'interpolated',False),
    ('copied',False,False,'keyframe',True),
    ('manual',False,False,'keyframe',True),
])
def test_export_protection_matches_actual_interpolation_anchors(reviewed_project, origin, corrected, approved, kind, protected):
    pid, vid, ident, _ = reviewed_project
    make_named(pid, ident)
    with db.transaction() as connection:
        row = connection.execute("SELECT id,data FROM entities WHERE project_id=? AND collection='observations' LIMIT 1", (pid,)).fetchone()
        observation = json.loads(row['data'])
        observation['provenance']['class:Vehicle'] = {'origin':origin, 'human_corrected':corrected}
        observation['review_state'] = 'approved' if approved else 'draft'
        connection.execute("UPDATE entities SET data=? WHERE project_id=? AND collection='observations' AND id=?", (json.dumps(observation),pid,row['id']))
    doc = annotation_document(pid, vid)
    row = next(row for row in doc['annotation_index'] if row['observation_id'] == observation['id'] and row['class_key'] == 'class:Vehicle')
    assert row['annotation_type'] == kind and row['protected_from_interpolation'] == protected
    assert validate_document(doc)['passed']
    row['protected_from_interpolation'] = not protected
    assert not validate_document(doc)['passed']
