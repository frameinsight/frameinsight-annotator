"""Revision-bound, media-free multi-camera delivery and explicit remapped import.

Shared people belong to a camera session. Equal local track numbers never imply
an association, and importing a session never overwrites existing video tracks.
"""
import copy
import gzip
import hashlib
import io
import json
import re
import uuid
from pathlib import Path

import ijson
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from ijson.common import ObjectBuilder
from pydantic import BaseModel, Field

from . import db
from .annotation_export import annotation_document
from .config import DATA, safe_path
from .export_names import json_filename
from .json_stream import JSON_STATE_LIMIT, JSON_UPLOAD_LIMIT, LimitedReader, UniqueKeys
from .multicam import get_session, insert_session, validate_session_snapshot
from .native_annotations import preview_native
from .review_validation import LIMITATION, validate_document
from .schema import Operation, validate_state
from .version import APP_VERSION
from .video import sha256

router = APIRouter()
FORMAT = 'frameinsight.multicam.annotations'


class SessionValidation(BaseModel):
    revision: int = Field(ge=0)
    project_revision: int = Field(ge=0)
    visual_confirmed: bool = False


class SessionExport(BaseModel):
    revision: int = Field(ge=0)
    project_revision: int = Field(ge=0)
    validation_id: str
    filename: str | None = None


def scope_document(document, video_ids):
    """Keep v3 semantics intact, including every class and hidden interval."""
    document = copy.deepcopy(document)
    ids = set(video_ids)
    state = document['state']
    people = {row['identity_uuid'] for col in ('segments', 'observations', 'intervals')
              for row in state[col].values() if row['video_id'] in ids}
    for col in ('segments', 'observations', 'intervals', 'reviews', 'proposal_reviews'):
        state[col] = {key: row for key, row in state[col].items() if row['video_id'] in ids}
    state['identities'] = {key: row for key, row in state['identities'].items() if key in people}
    state['links'] = {key: row for key, row in state['links'].items() if row['source'] in people and row['target'] in people}
    for key in ('videos', 'frames'):
        document[key] = {vid: value for vid, value in document[key].items() if vid in ids}
    for key in ('annotation_index', 'frame_annotations', 'visibility_intervals', 'presence_intervals'):
        document[key] = [row for row in document[key] if row['video_id'] in ids]
    rows = document['annotation_index']
    document['video_scope'] = next(iter(ids)) if len(ids) == 1 else None
    document['summary'] = {
        'videos': len(ids), 'people': len(people), 'observations': len(state['observations']), 'boxes': len(rows),
        'boxes_by_class': {key: sum(row['class_key'] == key for row in rows) for key in sorted({r['class_key'] for r in rows})},
        'visible_boxes': sum(row['class_key'] == 'person_visible' for row in rows),
        'extended_boxes': sum(row['class_key'] == 'person_ext' for row in rows),
        'frames_in_ledger': sum(map(len, document['frames'].values())),
        'whole_frames_checked': sum(bool(row['complete']) for row in state['reviews'].values()),
    }
    document['conventions']['active_classes'] = sorted({row['class_name'] for row in rows}) or document['classes']
    return document


def session_document(session, project):
    """Caller holds the write transaction so all source snapshots are consistent."""
    annotations = scope_document(annotation_document(project['id']), [c['video_id'] for c in session['cameras']])
    people = {person['id']: person for person in session['people']}
    assignments = {(a['video_id'], a['identity_uuid']): a['person_uuid'] for a in session['assignments']}
    cameras = {camera['video_id']: camera for camera in session['cameras']}
    origins = {vid: ledger[0]['seconds'] if ledger else 0 for vid, ledger in annotations['frames'].items()}
    for key in ('annotation_index', 'frame_annotations'):
        for row in annotations[key]:
            person_uuid = assignments.get((row['video_id'], row['identity_uuid']))
            timestamp = row['timestamp_seconds']
            row.update(camera_id=cameras[row['video_id']]['id'], person_uuid=person_uuid,
                       shared_person_id=people[person_uuid]['person_id'] if person_uuid else None,
                       session_timestamp_seconds=(timestamp-origins[row['video_id']]+cameras[row['video_id']]['offset_seconds']) if timestamp is not None else None)
    return {'format': FORMAT, 'schema_version': 1, 'app_version': APP_VERSION, 'exported_at': db.now(),
            'media_included': False, 'history_included': False, 'session': copy.deepcopy(session), 'annotations': annotations,
            'conventions': {'shared_identity_scope': 'session: use (session.id, person_uuid) together; shared_person_id is its positive display number.',
                            'local_identity_scope': 'video: local person_id/track_id and identity_uuid are preserved. Equal local numbers across cameras do not imply the same person.',
                            'synchronization': 'session_timestamp_seconds = source timestamp_seconds - first source timestamp_seconds + camera.offset_seconds.',
                            'unassigned': 'Null person_uuid and shared_person_id mean no cross-camera association has been confirmed.',
                            'absence': 'A missing box is annotation absence, not evidence of physical occlusion. Cameras may observe the same person simultaneously.'}}


def _fingerprint(document):
    # Output timestamps and descriptive validation proofs do not change annotation content.
    return hashlib.sha256(json.dumps({'session': document['session'],
        'annotations': {key: document['annotations'][key] for key in ('project', 'classes', 'class_colors', 'videos', 'frames', 'state')}},
        sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def structural_report(document):
    annotation = document['annotations']
    report = validate_document(annotation)
    session = document['session']
    project = {**annotation['project'], 'videos': annotation['videos'], 'state': annotation['state']}
    before = len(report['errors'])
    try:
        validate_session_snapshot(session, project, minimum_cameras=2)
    except (ValueError, KeyError, TypeError) as error:
        report['errors'].append({'code': 'session_references', 'message': str(error)})
    report['checks'].append({'name': 'Camera, shared person and local track references', 'passed': len(report['errors']) == before})
    if len(report['errors']) == before:
        people = {person['id']: person for person in session['people']}
        assignments = {(a['video_id'], a['identity_uuid']): a['person_uuid'] for a in session['assignments']}
        cameras = {camera['video_id']: camera for camera in session['cameras']}
        visible = {}
        unassigned = set()
        before = len(report['errors'])
        for row in annotation['annotation_index'] + annotation['frame_annotations']:
            vid, identity = row['video_id'], row['identity_uuid']
            shared = assignments.get((vid, identity))
            ledger = annotation['frames'].get(vid, [])
            expected_time = (row['timestamp_seconds']-ledger[0]['seconds']+cameras[vid]['offset_seconds']) if ledger and row['timestamp_seconds'] is not None else None
            if (row.get('person_uuid') != shared or row.get('shared_person_id') != (people[shared]['person_id'] if shared else None)
                or row.get('camera_id') != cameras[vid]['id'] or row.get('session_timestamp_seconds') != expected_time):
                report['errors'].append({'code': 'shared_identity_index', 'message': 'Shared identity or synchronized timestamp differs from the camera session.', 'video_id': vid, 'frame_index': row['frame_index']})
        for row in annotation['annotation_index']:
            shared = assignments.get((row['video_id'], row['identity_uuid']))
            if shared:
                visible.setdefault((row['video_id'], shared, row['frame_index']), set()).add(row['identity_uuid'])
            else:
                unassigned.add((row['video_id'], row['identity_uuid']))
        for vid, identity in sorted(unassigned):
            report['warnings'].append({'code': 'unassigned_track', 'message': 'This local track has no shared person assignment.', 'video_id': vid, 'identity_uuid': identity})
        overlaps = {}
        for (vid, person, frame), local_ids in visible.items():
            if len(local_ids) > 1:
                overlaps.setdefault((vid, person), []).append(frame)
        for (vid, person), frames in overlaps.items():
            report['warnings'].append({'code': 'same_camera_overlap', 'message': 'Multiple tracks assigned to this person have boxes on the same frame in one camera. Review the assignment.',
                                      'video_id': vid, 'person_uuid': person, 'first_frame': min(frames), 'last_frame': max(frames), 'frames': len(frames)})
        report['checks'].append({'name': 'Shared identities and synchronized timestamps in exported rows', 'passed': len(report['errors']) == before})
    report['passed'] = not report['errors']
    report['summary'].update(cameras=len(session['cameras']), shared_people=len(session['people']), assignments=len(session['assignments']))
    report['limitation'] = LIMITATION + ' Cross-camera matches and camera synchronization require human review.'
    return report


def _current(c, sid, revision, project_revision):
    session = get_session(sid, connection=c)
    project = db.get_state(c, session['project_id'])
    if session['revision'] != revision:
        raise ValueError('The camera session changed. Reload and validate again.')
    if project['revision'] != project_revision:
        raise db.Conflict(project['revision'])
    return session, project


@router.post('/api/camera-sessions/{sid}/validate')
def validate_session(sid: str, body: SessionValidation):
    if not body.visual_confirmed:
        raise ValueError('Review the camera recordings and confirm the annotations and shared identities first.')
    with db.transaction() as c:
        session, project = _current(c, sid, body.revision, body.project_revision)
        document = session_document(session, project)
        report = structural_report(document)
        report.update(validation_id=str(uuid.uuid4()), session_id=sid, project_id=project['id'], revision=session['revision'],
                      project_revision=project['revision'], fingerprint=_fingerprint(document), app_version=APP_VERSION, created_at=db.now())
        c.execute('INSERT INTO validations VALUES(?,?,?,?,?,?)', (report['validation_id'], project['id'], sid, project['revision'], 'multicamera', json.dumps(report)))
        return report


def validation_proof(c, sid, settings):
    session, project = _current(c, sid, settings['revision'], settings['project_revision'])
    row = c.execute('SELECT data FROM validations WHERE id=? AND project_id=? AND video_id=? AND review_job_id=?',
                    (settings['validation_id'], project['id'], sid, 'multicamera')).fetchone()
    if not row:
        raise ValueError('Validate this camera session before exporting.')
    report = json.loads(row['data'])
    document = session_document(session, project)
    if (not report.get('passed') or report.get('app_version') != APP_VERSION or report.get('revision') != session['revision']
        or report.get('project_revision') != project['revision'] or report.get('fingerprint') != _fingerprint(document)):
        raise ValueError('The camera session or its annotations changed. Validate again before exporting.')
    return document, report


@router.post('/api/camera-sessions/{sid}/export')
def export_session(sid: str, body: SessionExport):
    path = None
    try:
        with db.transaction() as c:
            document, report = validation_proof(c, sid, body.model_dump())
            document['validation'] = report
            eid = str(uuid.uuid4())
            path = DATA / 'exports' / f'{eid}.json'
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('w', encoding='utf-8') as output:
                json.dump(document, output, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            name = json_filename(body.filename or document['session']['name'])
            data = {'id': eid, 'project_id': document['session']['project_id'], 'session_id': sid, 'path': str(path),
                    'filename': name, 'file_hash': sha256(path), 'settings': body.model_dump(), 'created_at': db.now(), 'format': FORMAT}
            c.execute('INSERT INTO exports VALUES(?,?,?)', (eid, data['project_id'], json.dumps(data)))
        return {'export_id': eid, 'filename': name, 'download_url': f'/api/camera-session-exports/{eid}/download'}
    except Exception:
        if path:
            path.unlink(missing_ok=True)
        raise


@router.get('/api/camera-session-exports/{eid}/download')
def download_session_export(eid: str, filename: str | None = None):
    with db.transaction() as c:
        row = c.execute('SELECT data FROM exports WHERE id=?', (eid,)).fetchone()
        if not row:
            raise KeyError('Export not found')
        data = json.loads(row['data'])
        if data.get('format') != FORMAT:
            raise ValueError('This is not a camera session export')
        validation_proof(c, data['session_id'], data['settings'])
        path = safe_path(data['path'], DATA)
        if not path.is_file() or sha256(path) != data['file_hash']:
            raise ValueError('The export file changed. Prepare the download again.')
    return FileResponse(path, filename=json_filename(filename or data['filename']), media_type='application/json', headers={'X-Content-Type-Options': 'nosniff'})


def read_session_json(source):
    """Bound decoded input and retained state; accept JSON.gz without extracting files."""
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    source.seek(0, 2)
    if source.tell() > JSON_UPLOAD_LIMIT:
        raise ValueError('Camera session JSON upload limit is 1 GiB')
    source.seek(0)
    magic = source.read(3)
    source.seek(0)
    compressed = magic[:2] == b'\x1f\x8b'
    decoded = gzip.GzipFile(fileobj=source) if compressed else source
    try:
        if compressed:
            if decoded.peek(3)[:3] == b'\xef\xbb\xbf': decoded.read(3)
        elif magic == b'\xef\xbb\xbf': source.read(3)
        builder = ObjectBuilder(map_type=UniqueKeys)
        depth = retained = 0
        for event, value in ijson.basic_parse(LimitedReader(decoded), use_float=True):
            retained += len(value.encode('utf-8')) if isinstance(value, str) else 16
            if retained > JSON_STATE_LIMIT:
                raise ValueError('Camera session state exceeds 128 MiB. Import a smaller session.')
            if event in ('start_map', 'start_array'): depth += 1
            elif event in ('end_map', 'end_array'): depth -= 1
            if depth > 64: raise ValueError('Camera session JSON is nested too deeply')
            builder.event(event, value)
        document = builder.value
        if not isinstance(document, dict) or document.get('format') != FORMAT or document.get('schema_version') != 1:
            raise ValueError('Choose a Frameinsight multi-camera annotation JSON version 1.')
        def plain(value):
            if isinstance(value, dict): return {key: plain(item) for key, item in value.items()}
            if isinstance(value, list): return [plain(item) for item in value]
            return value
        # Duplicate-key guards are parser-only. The importer scopes and remaps
        # its private copy, so existing fields must be writable after parsing.
        return plain(document)
    except (ijson.JSONError, UnicodeError, EOFError, OSError, OverflowError) as error:
        raise ValueError('Choose a complete, valid camera session JSON or JSON.gz file.') from error
    finally:
        if compressed: decoded.close()


def import_session_document(pid, document, video_mapping, project_revision):
    if not isinstance(video_mapping, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in video_mapping.items()):
        raise ValueError('Map every source video ID to an existing video in this project.')
    try:
        report = structural_report(document)
    except (KeyError, TypeError, AttributeError, IndexError) as error:
        raise ValueError('Invalid multi-camera annotation structure.') from error
    if not report['passed']:
        raise ValueError('Invalid camera session: ' + '; '.join(e['message'] for e in report['errors'][:5]))
    source = document['annotations']
    if set(video_mapping) != set(source['videos']) or len(set(video_mapping.values())) != len(video_mapping):
        raise ValueError('Map each exported camera video to a different existing target video; no automatic filename or ID matching.')
    with db.transaction() as c:
        project = db.get_state(c, pid)
        if project['revision'] != project_revision:
            raise db.Conflict(project['revision'])
        changes, identity_map, warnings = [], {}, []
        working = copy.deepcopy(project)
        working['classes'] = list(dict.fromkeys(project['classes'] + source['classes']))
        if len(working['classes']) > 100:
            raise ValueError('Import would exceed the project limit of 100 classes')
        source_palette = source.get('class_colors', {})
        if not isinstance(source_palette, dict) or any(not isinstance(name, str) or not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color) for name, color in source_palette.items()):
            raise ValueError('Invalid class colors in camera session')
        for old_vid, new_vid in video_mapping.items():
            original, target = source['videos'][old_vid], project['videos'].get(new_vid)
            if not target or target.get('status') != 'ready':
                raise ValueError('Every mapped target video must belong to this project and finish indexing.')
            if not original.get('source_hash') or original['source_hash'] != target.get('source_hash'):
                raise ValueError('The mapped video SHA-256 must match the original recording exactly.')
            ledger = [json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index', (new_vid,))]
            signature = lambda frames: [(f['frame_index'], f['pts'], f['time_base_num'], f['time_base_den']) for f in frames]
            if signature(ledger) != signature(source['frames'][old_vid]):
                raise ValueError('The mapped source frame ledger differs from the exported recording.')
            scoped = scope_document(source, [old_vid])
            if not scoped['state']['identities']:
                if any(original.get(k) != target.get(k) for k in ('width', 'height', 'frame_count')):
                    raise ValueError('Video dimensions or frame count do not match the exported video')
                continue
            minimal = {key: scoped[key] for key in ('format', 'schema_version', 'videos', 'state')}
            preview = preview_native(json.dumps(minimal, allow_nan=False).encode(), working, new_vid, 'add')
            new_identities = [ch['id'] for ch in preview['changes'] if ch['collection'] == 'identities']
            for old, new in zip(scoped['state']['identities'], new_identities, strict=True):
                identity_map[(old_vid, old)] = new
            changes.extend(preview['changes'])
            warnings.extend(preview['warnings'])
            for change in preview['changes']:
                working['state'][change['collection']][change['id']] = change['after']
            for name in preview['classes']:
                if name not in working['classes']: working['classes'].append(name)
        if len(changes) > 49000:
            raise ValueError('Import at most 49,000 annotation entities in one camera session.')
        people_map = {p['id']: str(uuid.uuid4()) for p in document['session']['people']}
        body = {'name': document['session']['name'],
                'cameras': [{**cam, 'id': str(uuid.uuid4()), 'video_id': video_mapping[cam['video_id']]} for cam in document['session']['cameras']],
                'people': [{**person, 'id': people_map[person['id']]} for person in document['session']['people']],
                'assignments': [{**a, 'video_id': video_mapping[a['video_id']], 'identity_uuid': identity_map[(a['video_id'], a['identity_uuid'])],
                                 'person_uuid': people_map[a['person_uuid']]} for a in document['session']['assignments']]}
        validate_state(working['state'], working['videos'], visible_only=True, structural_only=True)
        operation = Operation(id=str(uuid.uuid4()), base_revision=project_revision, label='Import multi-camera annotations', changes=changes)
        for change in changes:
            c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, change['collection'], change['id'], json.dumps(change['after'])))
        palette = dict(project['class_colors'])
        for name in working['classes']:
            if name in source_palette: palette.setdefault(name, source_palette[name])
        for person in working['state']['identities'].values():
            for style in person.get('box_styles', {}).values(): palette.setdefault(style['class_name'], style['color'])
        c.execute('UPDATE projects SET revision=?,classes=?,class_colors=? WHERE id=?',
                  (project_revision+1, json.dumps(working['classes']), json.dumps(palette), pid))
        c.execute('INSERT INTO operations VALUES(?,?,?,?,?)', (operation.id, pid, project_revision+1, operation.model_dump_json(), db.now()))
        session = insert_session(c, pid, body)
        return {'session': session, 'project_revision': project_revision+1,
                'mapping': [{'source_video_id': vid, 'source_identity_uuid': old, 'video_id': video_mapping[vid], 'identity_uuid': new} for (vid, old), new in identity_map.items()],
                'warnings': list(dict.fromkeys(warnings)), 'summary': {'cameras': len(body['cameras']), 'tracks': len(identity_map), 'shared_people': len(people_map)}}


@router.post('/api/projects/{pid}/camera-sessions/import')
def import_session(pid: str, file: UploadFile = File(...), video_mapping: str = Form(...), project_revision: int = Form(...)):
    try:
        mapping = json.loads(video_mapping)
    except (ValueError, TypeError) as error:
        raise ValueError('Provide an explicit source-to-target video mapping as JSON.') from error
    return import_session_document(pid, read_session_json(file.file), mapping, project_revision)


@router.post('/api/projects/{pid}/camera-sessions/import/preview')
def preview_session_import(pid: str, file: UploadFile = File(...)):
    db.snapshot(pid)
    document = read_session_json(file.file)
    try:
        report = structural_report(document)
    except (KeyError, TypeError, AttributeError, IndexError) as error:
        raise ValueError('Invalid multi-camera annotation structure.') from error
    if not report['passed']:
        raise ValueError('Invalid camera session: ' + '; '.join(e['message'] for e in report['errors'][:5]))
    videos = document['annotations']['videos']
    return {'name': document['session']['name'], 'cameras': [
        {**camera, **{key: videos[camera['video_id']].get(key) for key in ('source_hash', 'frame_count', 'width', 'height')},
         'video_name': videos[camera['video_id']]['name']} for camera in document['session']['cameras']],
        'summary': report['summary'], 'warnings': report['warnings']}
