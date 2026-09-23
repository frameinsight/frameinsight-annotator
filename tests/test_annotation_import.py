import io
import json
import zipfile
import pytest
from backend.app.annotation_import import preview
from backend.app.schema import Operation
from backend.app import db
from test_delete_video import client, add_video


def archive(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as z:
        for name, content in files.items(): z.writestr(name, content)
    return result.getvalue()


@pytest.fixture
def project(client):
    p = client.post('/api/projects', json={'name': 'Import', 'classes': ['Person']}).json()
    video = add_video(p['id'])
    return db.snapshot(p['id']), video['id']


def test_yolo_no_ids_does_not_invent_tracks(project):
    p, v = project
    result = preview(archive({'obj.names': 'Person', 'frame_000000.txt': '0 .5 .5 .2 .4', 'frame_000010.txt': '0 .5 .5 .2 .4'}), 'labels.zip', p, v)
    assert result['summary'] == dict(boxes=2, tracks=2, frames=2, first_frame=0, last_frame=10)
    assert 'no track IDs' in result['warnings'][0]
    assert db.snapshot(p['id']) == p


def test_yolo_tracks_classes_and_undo_are_atomic(project):
    p, v = project
    raw = archive({'data.yaml': 'names:\n  0: Person\n  1: Extended\n', 'labels/train/000001.txt': '0 .5 .5 .2 .4 7\n1 .5 .5 .3 .5 7', 'labels/train/000011.txt': '0 .6 .5 .2 .4 7'})
    result = preview(raw, 'labels.zip', p, v, 'yolo_tracks', 1)
    assert result['summary']['tracks'] == 1
    assert result['mapping'] == [{'source': 7, 'track_id': 7}]
    operation = Operation(id='import', base_revision=p['revision'], label='Import', changes=result['changes'])
    db.apply(p['id'], operation)
    after = db.snapshot(p['id'])
    assert after['classes'] == ['Person', 'Extended']
    observations = sorted(after['state']['observations'].values(), key=lambda o:o['frame_index'])
    assert observations[0]['boxes']['class:Person'] == pytest.approx([256, 108, 384, 252])
    assert len(observations) == 2  # Missing source frames are not silently interpolated.
    inverse = [{**c, 'before': c['after'], 'after': None} for c in result['changes']]
    db.apply(p['id'], Operation(id='undo', base_revision=after['revision'], label='Undo import', compensates='import', changes=inverse))
    assert db.snapshot(p['id'])['state'] == p['state']


def test_mot_numbering_ignore_and_collision(project):
    p, v = project
    p['state']['identities']['old'] = {'person_id': 7}
    raw = b'1,7,1,1,20,30,1,1,.5\n11,7,11,1,20,30,1,1,1\n5,8,1,1,10,10,0,1,0'
    result = preview(raw, 'gt.txt', p, v, 'mot', 1, 1)
    assert result['summary']['boxes'] == 2
    assert result['mapping'][0]['track_id'] != 7
    o = [c['after'] for c in result['changes'] if c['collection'] == 'observations'][0]
    assert o['frame_index'] == 0 and o['boxes']['class:pedestrian'] == [0, 0, 20, 30]
    assert len(result['warnings']) == 2


@pytest.mark.parametrize('files,match', [
    ({'../0.txt': '0 .5 .5 .2 .2'}, 'Unsafe'),
    ({'0.txt': '0 nan .5 .2 .2'}, 'Invalid box'),
    ({'99.txt': '0 .5 .5 .2 .2'}, 'outside'),
    ({'0.txt': '0 .5 .5 .2 .2 7'}, 'column'),
    ({'a/0.txt': '', 'b/0.txt': ''}, 'Multiple'),
])
def test_rejects_bad_yolo_without_mutation(project, files, match):
    p, v = project
    with pytest.raises(ValueError, match=match): preview(archive(files), 'test.zip', p, v)
    assert db.snapshot(p['id']) == p


def test_duplicate_class_box_and_explicit_clip(project):
    p, v = project
    with pytest.raises(ValueError, match='Duplicate'):
        preview(b'0 .5 .5 .2 .2 7\n0 .6 .5 .2 .2 7', '0.txt', p, v, 'yolo_tracks')
    with pytest.raises(ValueError, match='outside'):
        preview(b'0 .05 .5 .2 .2', '0.txt', p, v)
    result = preview(b'0 .05 .5 .2 .2', '0.txt', p, v, clip_boxes=True)
    assert any('clipped' in w for w in result['warnings'])


def test_preview_endpoint_is_read_only(client, project):
    p, v = project
    response = client.post(f'/api/projects/{p["id"]}/imports/annotations/preview?video_id={v}', files={'file': ('0.txt', b'0 .5 .5 .2 .2')}, data={'format':'yolo'})
    assert response.status_code == 200, response.text
    assert response.json()['summary']['boxes'] == 1
    assert db.snapshot(p['id']) == p
