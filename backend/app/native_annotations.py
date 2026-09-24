"""Import current annotation state, never historical operations or validation proofs."""
import copy
import json
import uuid
from .schema import MODELS, validate_state
from .geometry import box_items, box_style


def preview_native(raw, project, video_id):
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError('Annotation upload limit is 50 MB')
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Choose a valid Frameinsight annotation JSON file') from None
    if not isinstance(doc, dict) or doc.get('format') != 'frameinsight.annotations' or doc.get('schema_version') not in (2, 3):
        raise ValueError('Expected Frameinsight annotation JSON version 2 or 3')
    videos, state = doc.get('videos'), doc.get('state')
    if not isinstance(videos, dict) or len(videos) != 1 or not isinstance(state, dict):
        raise ValueError('Import an export containing exactly one video and its saved state')
    source_id, source = next(iter(videos.items()))
    target = project['videos'].get(video_id)
    if not target or target.get('status') != 'ready':
        raise ValueError('Wait until the selected video is ready')
    if not isinstance(source, dict) or any(source.get(k) != target.get(k) for k in ('width', 'height', 'frame_count')):
        raise ValueError('Video dimensions or frame count do not match the exported video')
    if source.get('source_hash') and target.get('source_hash') and source['source_hash'] != target['source_hash']:
        raise ValueError('Video SHA-256 does not match. Import the original video used for this export.')
    normalized = {}
    for collection, model in MODELS.items():
        values = state.get(collection, {})
        if not isinstance(values, dict):
            raise ValueError('Invalid annotation state collection')
        if sum(len(v) for v in normalized.values()) + len(values) > 49000:
            raise ValueError('Import at most 49,000 entities at a time')
        normalized[collection] = {}
        for key, value in values.items():
            if not isinstance(value, dict) or value.get('id') != key:
                raise ValueError('Annotation entity ID does not match its key')
            normalized[collection][key] = model.model_validate(value).model_dump(mode='json')
    validate_state(normalized, {source_id: source}, visible_only=True, structural_only=True)
    if any(p['person_id'] is None for p in normalized['identities'].values()):
        raise ValueError('Every imported track needs a numeric ID')
    boxes = sum(len(list(box_items(o))) for o in normalized['observations'].values())
    if boxes > 45000:
        raise ValueError('Import at most 45,000 boxes at a time')
    if not normalized['identities']:
        raise ValueError('No tracks found in this export')
    names = {box_style(normalized['identities'][o['identity_uuid']], g)['class_name'] for o in normalized['observations'].values() for g, _ in box_items(o)}
    names.update(s['class_name'] for p in normalized['identities'].values() for s in p['box_styles'].values())
    if len(set(project.get('classes', [])) | names) > 100:
        raise ValueError('Import would exceed the project limit of 100 classes')
    # Never trust exported identity UUIDs to join current tracks implicitly.
    ids = {collection: {key: str(uuid.uuid4()) for key in values} for collection, values in normalized.items()}
    used = {p['person_id'] for p in project['state']['identities'].values()}
    reserved = {p['person_id'] for p in normalized['identities'].values()} - used
    allocated = used | reserved
    mapping, changes, next_number = [], [], 1
    for collection in ('identities', 'segments', 'observations', 'intervals', 'links'):
        for key, value in normalized[collection].items():
            row = copy.deepcopy(value)
            row['id'] = ids[collection][key]
            if 'video_id' in row:
                row['video_id'] = video_id
            if 'identity_uuid' in row:
                row['identity_uuid'] = ids['identities'][row['identity_uuid']]
            if 'segment_id' in row:
                row['segment_id'] = ids['segments'][row['segment_id']]
            if collection == 'links':
                row['source'] = ids['identities'][row['source']]
                row['target'] = ids['identities'][row['target']]
            if collection == 'identities':
                number = row['person_id']
                if number not in reserved:
                    while next_number in allocated:
                        next_number += 1
                    number = next_number
                    allocated.add(number)
                mapping.append({'source': row['person_id'], 'track_id': number})
                row['person_id'] = number
            # Keep box origin/corrections, but no external proposal references or approval.
            if collection == 'observations':
                row['review_state'] = 'draft'
                for provenance in row['provenance'].values():
                    provenance['proposal_id'] = None
            changes.append({'collection': collection, 'id': row['id'], 'before': None, 'after': row})
    merged = copy.deepcopy(project['state'])
    for change in changes:
        merged[change['collection']][change['id']] = change['after']
    validate_state(merged, project['videos'], visible_only=True, structural_only=True)
    warnings = ['Imported annotations need a fresh visual review and validation. Exported validation and edit history are not restored; use a project backup for full history.']
    if not source.get('source_hash') or not target.get('source_hash'):
        warnings.append('A video fingerprint is unavailable. Dimensions and frame count match; confirm visually that this is the correct video.')
    if any(m['source'] != m['track_id'] for m in mapping):
        warnings.append('Some IDs already exist and were reassigned. Import into a new project to retain every numeric ID.')
    frames = [o['frame_index'] for o in normalized['observations'].values()]
    return {'base_revision': project['revision'], 'changes': changes, 'classes': sorted(names), 'mapping': mapping, 'warnings': warnings,
            'summary': {'boxes': boxes, 'tracks': len(mapping), 'frames': len(set(frames)), 'first_frame': min(frames, default=0), 'last_frame': max(frames, default=0)}}
