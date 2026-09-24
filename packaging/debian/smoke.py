"""Run against the installed Linux app as an ordinary user in an isolated container."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.schema import Identity, Observation, Segment
import av

parser = argparse.ArgumentParser()
parser.add_argument('--fixture', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
uid = lambda: str(uuid.uuid4())


def request(path, data=None, raw=False, method=None):
    body = json.dumps(data).encode() if data is not None else None
    query = urllib.request.Request('http://127.0.0.1:8765' + path, body, headers={'Content-Type': 'application/json'} if body else {}, method=method)
    with urllib.request.urlopen(query, timeout=20) as response:
        return response.read() if raw else json.load(response)


def finished(job):
    for _ in range(300):
        current = request('/api/jobs/' + job['id'])
        assert current['status'] not in ('failed', 'cancelled'), current
        if current['status'] == 'completed': return current
        time.sleep(.2)
    raise AssertionError('Job did not finish: ' + job['id'])


def rejected(path, data, status=422):
    try: request(path, data)
    except urllib.error.HTTPError as error: assert error.code == status, (error.code, error.read())
    else: raise AssertionError('Expected request rejection: ' + path)



def preview_export(pid, vid, document):
    boundary = 'frameinsight-json-import-smoke'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\nframeinsight\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="annotations.json"\r\nContent-Type: application/json\r\n\r\n'.encode() + json.dumps(document).encode() + f'\r\n--{boundary}--\r\n'.encode())
    query = urllib.request.Request(f'http://127.0.0.1:8765/api/projects/{pid}/imports/annotations/preview?video_id={vid}', body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(query, timeout=20) as response:
        result = json.load(response)
    assert result['summary']['boxes'] == len(document['annotation_index'])
    assert result['mapping'][0]['source'] == 7 and result['mapping'][0]['track_id'] != 7
    assert request('/api/projects/' + pid)['state'] == document['state']

def structural_delivery(pid, vid, revision, boxes, class_names):
    before = request('/api/projects/' + pid)
    def deliver(current_revision):
        validation = request('/api/videos/' + vid + '/validate', {'revision': current_revision, 'visual_confirmed': True, 'coverage': 'selected_people'})
        assert validation['passed'] and validation['mode'] == 'structural', validation
        assert validation['coverage'] == 'selected_people' and validation['limitation']
        assert 'review_job_id' not in validation and 'review_video_hash' not in validation
        assert not any('render' in check['name'].lower() for check in validation['checks'])
        proof = {'revision': current_revision, 'validation_id': validation['validation_id']}
        request('/api/videos/' + vid + '/finish', {'confirmed': True, **proof})
        job = finished(request('/api/projects/' + pid + '/exports', {'format': 'annotations_json', 'video_id': vid, 'include_videos': False, **proof}))
        document = request('/api/exports/' + job['export_id'])
        preview_export(pid, vid, document)
        assert document['schema_version'] == 3 and document['app_version'] == manifest['version'] and document['media_included'] is False
        assert document['validation']['mode'] == 'structural' and document['validation']['validation_id'] == validation['validation_id']
        assert 'review_job_id' not in document['validation'] and 'review_video_hash' not in document['validation']
        assert document['project']['revision'] == current_revision and document['state'] == before['state']
        assert {row['track_id'] for row in document['annotation_index']} == {7}
        assert {row['person_id'] for row in document['annotation_index']} == {7}
        assert len(document['annotation_index']) == len(boxes)
        assert {row['class_key']: row['class_name'] for row in document['annotation_index']} == class_names
        assert document['frame_annotations'][0]['boxes'] == boxes
        assert not any(job['kind'] == 'review' for job in request('/api/projects/' + pid + '/jobs'))
        assert next(video for video in request('/api/video-library') if video['id'] == vid)['finished']
        return proof, job['export_id']
    proof, export_id = deliver(revision)
    updated = request('/api/projects/' + pid + '/settings', {'base_revision': revision, 'name': before['name'] + ' revised', 'request_id': str(uuid.uuid4())}, method='PATCH')
    assert updated['revision'] == revision + 1 and updated['state'] == before['state']
    assert not next(video for video in request('/api/video-library') if video['id'] == vid)['finished']
    rejected('/api/projects/' + pid + '/exports', {'format': 'annotations_json', 'video_id': vid, **proof}, 409)
    rejected('/api/exports/' + export_id, None, 409)
    deliver(updated['revision'])
    return updated['revision']


binary = '/usr/bin/frameinsight'
data = Path(os.environ['XDG_DATA_HOME']) / 'frameinsight/data'
state = Path(os.environ['XDG_STATE_HOME']) / 'frameinsight'
manifest = json.loads(Path('/opt/frameinsight/build-manifest.json').read_text())
try:
    helper = subprocess.run([binary, '--update-helper', '--help'], capture_output=True, check=True, timeout=15)
    assert b'--sha256' in helper.stdout and b'--server' in helper.stdout
    subprocess.run([binary, '--no-browser'], check=True, timeout=120)
    session = json.loads((state / 'session.json').read_text())
    subprocess.run([binary, '--no-browser'], check=True, timeout=15)
    assert json.loads((state / 'session.json').read_text())['pid'] == session['pid']
    assert b'Frameinsight' in request('/', raw=True)
    assert request('/api/updates/status')['can_install'] is True
    guard = subprocess.run(['/bin/sh', str(Path(__file__).with_name('maintainer-check.sh'))], capture_output=True)
    assert guard.returncode == 1 and b'Close Frameinsight' in guard.stderr
    project = request('/api/projects', {'name': 'Linux package acceptance', 'classes': ['Vehicle', 'Plate', 'Driver']})
    pid = project['id']
    boundary = 'frameinsight-debian-smoke'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="numbered.mp4"\r\nContent-Type: video/mp4\r\n\r\n'.encode() + args.fixture.read_bytes() + f'\r\n--{boundary}--\r\n'.encode())
    upload = urllib.request.Request(f'http://127.0.0.1:8765/api/projects/{pid}/videos', body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(upload, timeout=30) as response: vid = json.load(response)['video_id']
    for _ in range(300):
        video = request('/api/projects/' + pid)['videos'][vid]
        assert video['status'] != 'failed', video
        if video['status'] == 'ready': break
        time.sleep(.2)
    else: raise AssertionError('Video indexing did not complete')
    assert len(request('/api/videos/' + vid + '/ledger')) == 24
    assert request('/api/videos/' + vid + '/frames/10', raw=True).startswith(b'\x89PNG')
    who, segment, observation = uid(), uid(), uid()
    styles = {'class:' + name: {'class_name': name, 'color': color} for name, color in zip(['Vehicle', 'Plate', 'Driver'], ['#ff7700', '#33ddff', '#dd55ff'])}
    boxes = {'class:Vehicle': [10, 20, 200, 250], 'class:Plate': [50, 180, 90, 210], 'class:Driver': [90, 50, 150, 160]}
    identity = Identity(id=who, person_id=7, box_styles=styles).model_dump(mode='json')
    seg = Segment(id=segment, identity_uuid=who, video_id=vid, start=0).model_dump(mode='json')
    obs = Observation(id=observation, identity_uuid=who, segment_id=segment, video_id=vid, frame_index=10, boxes=boxes, provenance={key: {'origin': 'manual'} for key in boxes}).model_dump(mode='json')
    changes = [{'collection': name, 'id': value['id'], 'before': None, 'after': value} for name, value in [('identities', identity), ('segments', seg), ('observations', obs)]]
    request('/api/projects/' + pid + '/operations', {'id': uid(), 'base_revision': 0, 'label': 'Linux named classes', 'changes': changes})
    rejected('/api/videos/' + vid + '/finish', {'confirmed': True, 'revision': 1})
    rejected('/api/projects/' + pid + '/exports', {'format': 'annotations_json', 'video_id': vid})
    revision = structural_delivery(pid, vid, 1, boxes, {key: style['class_name'] for key, style in styles.items()})
    review = finished(request('/api/videos/' + vid + '/review-jobs', {'revision': revision}))
    metadata = request('/api/reviews/' + review['id'])
    assert metadata['rendered_frames'] == metadata['frame_count'] == 24 and not metadata['stale']
    with av.open(io.BytesIO(request('/api/reviews/' + review['id'] + '/video', raw=True))) as rendered:
        frames = list(rendered.decode(rendered.streams.video[0])); assert len(frames) == 24
        assert all(abs(float(frame.time) - metadata['frame_timestamps'][n]) < 1e-6 for n, frame in enumerate(frames))
    validation = request('/api/videos/' + vid + '/validate', {'revision': revision, 'review_job_id': review['id'], 'visual_confirmed': True, 'coverage': 'selected_people'})
    assert validation['passed'], validation
    proof = {'revision': revision, 'review_job_id': review['id'], 'validation_id': validation['validation_id']}
    request('/api/videos/' + vid + '/finish', {'confirmed': True, **proof})
    exported = finished(request('/api/projects/' + pid + '/exports', {'format': 'annotations_json', 'video_id': vid, **proof}))
    document = request('/api/exports/' + exported['export_id'])
    assert document['schema_version'] == 3 and document['app_version'] == manifest['version'] and document['media_included'] is False
    assert len(document['annotation_index']) == 3 and {row['track_id'] for row in document['annotation_index']} == {7}
    assert document['frame_annotations'][0]['boxes'] == boxes
    assert document['state']['observations'][observation] == obs
    subprocess.run([binary, '--stop', '--yes'], check=True, timeout=40)
    subprocess.run([binary, '--no-browser'], check=True, timeout=120)
    assert request('/api/projects/' + pid)['state']['observations'][observation] == obs
    assert next(video for video in request('/api/video-library') if video['id'] == vid)['finished']
    subprocess.run([binary, '--stop', '--yes'], check=True, timeout=40)
    report = {'app_version': manifest['version'], 'environment': 'Debian 12 container, non-root desktop user, headless runtime',
              'checks': ['installed desktop launcher', 'frozen update helper entrypoint', 'single instance', 'running-runtime upgrade/removal guard', 'HTTP frontend', 'updater package kind', 'multipart video import', '24 exact source frames', 'PNG decoding', 'three named classes share track ID', 'unvalidated finish/export rejected', 'structural validation and media-free JSON without a review job or review hash', 'native annotation JSON import preview and collision mapping', 'project settings preserve annotations and invalidate previous validation/export download', 'fresh structural validation after metadata edit', 'backwards-compatible full review MP4 and exact timestamps', 'revision-bound review validation', 'media-free JSON v3', 'graceful stop', 'restart preserves annotations and finished state'],
              'database': str(data / 'projects.sqlite3'), 'database_sha256': hashlib.sha256((data / 'projects.sqlite3').read_bytes()).hexdigest(),
              'native_desktop_gui_tested': False}
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
finally:
    subprocess.run([binary, '--stop', '--yes'], timeout=45)
