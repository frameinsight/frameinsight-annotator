"""Validate and append media-free Frameinsight annotations as one reversible operation."""
import copy
import hashlib
import json
import uuid

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from . import db
from .schema import MODELS, Operation, validate_state

router = APIRouter()
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
_GEOMETRIES = ('person_visible', 'person_ext')


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f'Duplicate JSON key: {key}')
        value[key] = item
    return value


def _invalid_number(value):
    raise ValueError(f'Non-finite JSON number: {value}')


def _read_document(raw):
    try:
        document = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=_object, parse_constant=_invalid_number)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Choose a valid UTF-8 Frameinsight annotation JSON file') from error
    if not isinstance(document, dict) or document.get('format') != 'frameinsight.annotations':
        raise ValueError('This is not a Frameinsight annotation JSON export')
    if type(document.get('schema_version')) is not int or document['schema_version'] not in (1, 2):
        raise ValueError('Supported annotation JSON schema versions are 1 and 2')
    conventions = document.get('conventions', {})
    if not isinstance(conventions, dict):
        raise ValueError('Invalid annotation conventions')
    if conventions.get('frame_indices', 'zero_based_source_frames') != 'zero_based_source_frames':
        raise ValueError('Annotations must use zero-based source frame indices')
    coordinates = conventions.get('coordinates', {})
    if not isinstance(coordinates, dict) or coordinates.get('units', 'original_image_pixels') != 'original_image_pixels' or coordinates.get('origin', 'top_left') != 'top_left':
        raise ValueError('Annotations must use original-image pixel coordinates with a top-left origin')
    return document


def _validated_source(document):
    videos = document.get('videos')
    raw_state = document.get('state')
    if not isinstance(videos, dict) or not videos or not isinstance(raw_state, dict):
        raise ValueError('The export must contain its original videos and annotation state')
    if set(raw_state) - set(MODELS):
        raise ValueError('The annotation state contains unsupported collections')
    for required in ('identities', 'segments', 'observations', 'intervals'):
        if not isinstance(raw_state.get(required), dict):
            raise ValueError(f'Missing or invalid annotation collection: {required}')
    for key, video in videos.items():
        if not isinstance(video, dict) or video.get('id') != key or not key:
            raise ValueError('Invalid source video ID')
        for dimension in ('width', 'height', 'frame_count'):
            if type(video.get(dimension)) is not int or video[dimension] <= 0:
                raise ValueError(f'Source video {dimension} must be a positive integer')
    state = {key: {} for key in MODELS}
    for collection, model in MODELS.items():
        values = raw_state.get(collection, {})
        if not isinstance(values, dict):
            raise ValueError(f'Invalid annotation collection: {collection}')
        for key, value in values.items():
            if not isinstance(value, dict) or value.get('id') != key or not key:
                raise ValueError(f'Entity ID mismatch in {collection}')
            # Strict JSON validation accepts JSON box arrays, but rejects numeric
            # strings, fractional frame indices, booleans used as IDs, and extras.
            parsed = model.model_validate_json(json.dumps(value, allow_nan=False), strict=True)
            state[collection][key] = parsed.model_dump(mode='json', exclude_unset=collection in ('identities', 'intervals'))
            if collection == 'identities':
                state[collection][key].setdefault('person_id', None)
            if collection == 'observations' and set(value.get('provenance', {})) - set(_GEOMETRIES):
                raise ValueError('Observation provenance contains an unknown box type')
    validate_state(state, videos, visible_only=True)
    return videos, state


def _source_video(document, videos, target):
    digest = target.get('source_hash')
    if not isinstance(digest, str) or not digest:
        raise ValueError('Wait for the loaded video to finish hashing before importing annotations')
    matches = [key for key, video in videos.items() if video.get('source_hash') == digest]
    scope = document.get('video_scope')
    if scope is not None:
        if not isinstance(scope, str) or scope not in videos:
            raise ValueError('The export video scope is invalid')
        matches = [scope] if scope in matches else []
    if not matches:
        raise ValueError('Source video hash does not match. Load the exact original video used for these annotations')
    if len(matches) > 1:
        raise ValueError('This export contains multiple copies of the same video. Export the intended video separately')
    source_id = matches[0]
    source = videos[source_id]
    if any(source[key] != target.get(key) for key in ('width', 'height', 'frame_count')):
        raise ValueError('Source video dimensions or frame count do not match the loaded video')
    return source_id, source


def _check_derived_rows(document, state, source_id):
    """Never silently ignore edits made only to the v2 convenience tables."""
    if document['schema_version'] != 2:
        return
    expected = {}
    expected_frames = {}
    for obs in state['observations'].values():
        if obs['video_id'] != source_id:
            continue
        identity = state['identities'][obs['identity_uuid']]
        key = (obs['frame_index'], obs['identity_uuid'])
        expected_frames[key] = obs
        for geometry in _GEOMETRIES:
            if obs.get(geometry) is None:
                continue
            style = identity.get('box_styles', {}).get(geometry, {})
            expected[(*key, geometry)] = {
                'observation_id': obs['id'], 'person_id': identity.get('person_id'),
                'box_xyxy': obs[geometry],
                'class_name': style.get('class_name', identity.get('class_name', 'person_visible') if geometry == 'person_visible' else 'person_extended'),
                'color': style.get('color', identity.get('color', '#baa7ff') if geometry == 'person_visible' else '#67e2b1'),
            }
    if 'annotation_index' in document:
        rows = document['annotation_index']
        if not isinstance(rows, list):
            raise ValueError('Invalid annotation index')
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('Invalid annotation index row')
            if row.get('video_id') != source_id:
                continue
            if type(row.get('frame_index')) is not int or not isinstance(row.get('identity_uuid'), str) or row.get('geometry_name') not in _GEOMETRIES:
                raise ValueError('Invalid annotation index key')
            key = (row['frame_index'], row['identity_uuid'], row['geometry_name'])
            if key in seen or key not in expected or any(row.get(field) != value for field, value in expected[key].items()):
                raise ValueError('Annotation index differs from the authoritative state; export a fresh JSON file')
            seen.add(key)
        if seen != set(expected):
            raise ValueError('Annotation index is incomplete; export a fresh JSON file')
    if 'frame_annotations' in document:
        rows = document['frame_annotations']
        if not isinstance(rows, list):
            raise ValueError('Invalid frame annotation table')
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('Invalid frame annotation row')
            if row.get('video_id') != source_id:
                continue
            if type(row.get('frame_index')) is not int or not isinstance(row.get('identity_uuid'), str):
                raise ValueError('Invalid frame annotation key')
            key = (row['frame_index'], row['identity_uuid'])
            obs = expected_frames.get(key)
            if key in seen or not obs or row.get('observation_id') != obs['id'] or row.get('person_id') != state['identities'][obs['identity_uuid']].get('person_id') or row.get('boxes') != {'person_visible': obs.get('person_visible'), 'person_extended': obs.get('person_ext')}:
                raise ValueError('Frame annotations differ from the authoritative state; export a fresh JSON file')
            seen.add(key)
        if seen != set(expected_frames):
            raise ValueError('Frame annotation table is incomplete; export a fresh JSON file')


def _plan(document, project, video_id, token, digest):
    target = project['videos'].get(video_id)
    if not target:
        raise ValueError('The selected video does not belong to this project')
    if target.get('status') != 'ready':
        raise ValueError('Wait for the selected video to finish loading')
    videos, source_state = _validated_source(document)
    source_id, source = _source_video(document, videos, target)
    _check_derived_rows(document, source_state, source_id)
    warnings = []
    selected = {key: {} for key in MODELS}
    for collection in ('segments', 'observations', 'intervals'):
        selected[collection] = {key: copy.deepcopy(value) for key, value in source_state[collection].items() if value['video_id'] == source_id}
    people = {value['identity_uuid'] for collection in ('segments', 'observations', 'intervals') for value in selected[collection].values()}
    if not selected['observations']:
        raise ValueError('This video has no saved observations to import')
    selected['identities'] = {key: copy.deepcopy(source_state['identities'][key]) for key in sorted(people)}
    selected['links'] = {key: copy.deepcopy(value) for key, value in source_state['links'].items() if value['source'] in people and value['target'] in people}
    if len(videos) > 1:
        warnings.append('Only annotations for the matching video will be imported; other videos are left out.')
    if len(selected['links']) != len(source_state['links']):
        warnings.append('Identity links involving people outside this video are not imported.')
    if any(value['video_id'] == source_id for collection in ('reviews', 'proposal_reviews') for value in source_state[collection].values()):
        warnings.append('Source whole-frame checks and rejected detector suggestions are not imported; review the combined annotations here.')
    if document.get('operations') or document.get('restored_history') or document.get('detector'):
        warnings.append('Past edit history and detector caches are not imported. Box provenance, including source proposal references, is preserved.')
    if document['schema_version'] == 1:
        warnings.append('Legacy schema v1 labels are preserved as recorded. Check the Visible and Extended classes after import.')
    if any(obs['review_state'] == 'approved' for obs in selected['observations'].values()):
        warnings.append('Imported individual approvals are reset to draft so the combined work can be reviewed.')
    if any(identity.get('person_id') is None for identity in selected['identities'].values()):
        warnings.append('Some imported people do not have a numeric person ID; assign one with I when needed.')

    used = {person.get('person_id') for person in project['state']['identities'].values() if person.get('person_id') is not None}
    # Reserve all non-colliding source numbers before assigning replacements.
    reserved = used | {person.get('person_id') for person in selected['identities'].values() if person.get('person_id') is not None}
    remaps = []
    namespace = uuid.UUID(token)
    mapping = {collection: {key: str(uuid.uuid5(namespace, collection + ':' + key)) for key in values} for collection, values in selected.items()}
    next_number = 1
    changes = []
    imported_state = copy.deepcopy(project['state'])
    for collection, values in selected.items():
        for key, value in values.items():
            value['id'] = mapping[collection][key]
            if 'video_id' in value:
                value['video_id'] = video_id
            if 'identity_uuid' in value:
                value['identity_uuid'] = mapping['identities'][value['identity_uuid']]
            if collection == 'identities' and value.get('person_id') in used:
                while next_number in reserved:
                    next_number += 1
                old_number = value['person_id']
                value['person_id'] = next_number
                reserved.add(next_number)
                remaps.append({'source_identity_uuid': key, 'identity_uuid': value['id'], 'from': old_number, 'to': next_number})
            if collection == 'observations':
                value['segment_id'] = mapping['segments'][value['segment_id']]
                if value['review_state'] == 'approved':
                    value['review_state'] = 'draft'
            if collection == 'links':
                value['source'] = mapping['identities'][value['source']]
                value['target'] = mapping['identities'][value['target']]
            if value['id'] in imported_state[collection]:
                raise ValueError('An imported entity already exists. Use a new import preview')
            # Match db.apply's serialized field order as well as its values.
            # The browser undo journal compares JSON strings, including key order.
            value = MODELS[collection].model_validate(value).model_dump(mode='json', exclude_unset=collection in ('identities', 'intervals'))
            imported_state[collection][value['id']] = value
            changes.append({'collection': collection, 'id': value['id'], 'before': None, 'after': value})
    touched = {obs['frame_index'] for obs in selected['observations'].values()}
    for key, review in project['state']['reviews'].items():
        if review['video_id'] == video_id and review['frame_index'] in touched and review['complete']:
            after = {**review, 'complete': False}
            imported_state['reviews'][key] = after
            changes.append({'collection': 'reviews', 'id': key, 'before': review, 'after': after})
    if any(change['collection'] == 'reviews' for change in changes):
        warnings.append('Existing whole-frame checks on affected frames will be cleared; existing boxes remain unchanged.')
    if remaps:
        warnings.append('Colliding person IDs are assigned new numbers. Existing people are never merged or overwritten.')
    if len(changes) > 50000:
        raise ValueError('Import exceeds the 50,000-entity operation limit. Export a smaller video or annotation set')
    validate_state(imported_state, project['videos'], visible_only=True)
    operation = Operation(id='annotation-import:' + token, base_revision=project['revision'],
                          label='Import annotation JSON · ' + digest,
                          video_id=video_id, changes=changes)
    return operation, {
        'source_video_id': source_id, 'source_name': source.get('name', source_id),
        'import_token': token, 'imported_people': len(selected['identities']),
        'imported_boxes': sum(obs.get(geometry) is not None for obs in selected['observations'].values() for geometry in _GEOMETRIES),
        'imported_observations': len(selected['observations']),
        'person_id_remaps': remaps, 'warnings': warnings,
        'revision': project['revision'],
    }


@router.post('/api/projects/{pid}/imports/annotations')
def import_annotations(pid: str, video_id: str, file: UploadFile = File(...), preview: bool = True,
                       base_revision: int | None = Query(default=None, ge=0), import_token: str | None = None):
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, 'Annotation JSON exceeds the 100 MB upload limit')
    raw = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, 'Annotation JSON exceeds the 100 MB upload limit')
    if not raw:
        raise ValueError('The annotation JSON file is empty')
    digest = hashlib.sha256(raw).hexdigest()
    document = _read_document(raw)
    token = None
    if not preview:
        if base_revision is None or import_token is None:
            raise ValueError('Preview this file first, then submit its import token and base revision')
        try:
            token = str(uuid.UUID(import_token))
        except (ValueError, AttributeError) as error:
            raise ValueError('Invalid annotation import token; preview this file again') from error
        expected = str(uuid.uuid5(uuid.NAMESPACE_URL, f'frameinsight-annotation-import:{pid}:{video_id}:{digest}:{base_revision}'))
        if token != expected:
            raise ValueError('The file or import destination changed since preview; preview this file again')
    # Hold the application write lock across snapshot, planning and apply. The
    # revision check still protects against another process writing the database.
    with db.LOCK:
        if not preview:
            with db.connect() as connection:
                previous = connection.execute('SELECT project_id,data,revision FROM operations WHERE id=?', ('annotation-import:' + token,)).fetchone()
            if previous:
                operation = json.loads(previous['data'])
                if previous['project_id'] != pid or operation.get('video_id') != video_id or operation['label'] != 'Import annotation JSON · ' + digest:
                    raise HTTPException(409, 'This import token was already used for a different file or destination')
                counts = {collection: [change['after'] for change in operation['changes'] if change['collection'] == collection and change['before'] is None] for collection in ('identities', 'observations')}
                return {'preview': False, 'duplicate': True, 'revision': db.snapshot(pid)['revision'],
                        'operation_revision': previous['revision'], 'operation': operation, 'import_token': token,
                        'imported_people': len(counts['identities']), 'imported_observations': len(counts['observations']),
                        'imported_boxes': sum(obs.get(geometry) is not None for obs in counts['observations'] for geometry in _GEOMETRIES),
                        'person_id_remaps': [], 'warnings': ['This import was already applied; no annotations were added again.']}
        project = db.snapshot(pid)
        if preview:
            token = str(uuid.uuid5(uuid.NAMESPACE_URL, f"frameinsight-annotation-import:{pid}:{video_id}:{digest}:{project['revision']}"))
        if not preview and base_revision != project['revision']:
            raise db.Conflict(project['revision'])
        operation, result = _plan(document, project, video_id, token, digest)
        if preview:
            return {**result, 'preview': True, 'duplicate': False}
        applied = db.apply(pid, operation)
        return {**result, **applied, 'preview': False, 'operation_revision': applied['revision'], 'operation': operation.model_dump(mode='json')}
