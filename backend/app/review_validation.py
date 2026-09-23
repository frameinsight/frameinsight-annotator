"""Structural checks on the exact annotation document used for video review."""
import json
import math
from fractions import Fraction
from .schema import MODELS, validate_state

LIMITATION = 'Structural checks cannot determine whether two boxes show the same real person or whether a person was missed. Visual review and the stated coverage are the annotator’s confirmation.'


def numeric_box(box):
    return isinstance(box, (list, tuple)) and len(box) == 4 and all(type(x) in (int, float) and math.isfinite(x) for x in box)


def group_warnings(warnings):
    """Compress repeated containment notes without losing affected frame ranges."""
    grouped, other = {}, []
    for item in warnings:
        if item['code'] != 'visible_outside_extended':
            other.append(item); continue
        key = (item['code'], item.get('identity_uuid'), item.get('person_id'), item['message'])
        grouped.setdefault(key, []).append(item)
    result = list(other)
    for items in grouped.values():
        run = None
        for item in sorted(items, key=lambda row: row['frame_index']):
            if run and item['frame_index'] == run['end_frame_index'] + 1:
                run['end_frame_index'] = item['frame_index']; run['occurrences'] += 1
            else:
                run = {**item, 'end_frame_index': item['frame_index'], 'occurrences': 1}; result.append(run)
    for item in result:
        if item.get('occurrences', 1) > 1:
            item['message'] = f'Frames {item["frame_index"]}–{item["end_frame_index"]} ({item["occurrences"]} frames): ' + item['message']
    return sorted(result, key=lambda row: (row.get('frame_index', -1), row.get('person_id') or 0, row['code']))


def validate_document(document):
    errors, warnings, checks = [], [], []
    def error(code, message, **location): errors.append({'code': code, 'message': message, **location})
    def warning(code, message, **location): warnings.append({'code': code, 'message': message, **location})
    def check(name, before): checks.append({'name': name, 'passed': len(errors) == before})
    before = len(errors)
    try: json.loads(json.dumps(document, allow_nan=False, ensure_ascii=False))
    except (ValueError, TypeError) as e: error('json_serialization', f'The annotation document cannot be serialized as JSON: {e}')
    check('JSON serialization', before)
    state, videos, ledgers = document.get('state', {}), document.get('videos', {}), document.get('frames', {})
    before = len(errors)
    for collection, model in MODELS.items():
        for key, value in state.get(collection, {}).items():
            try:
                model.model_validate(value)
                if value.get('id') != key: raise ValueError('Entity key and ID differ')
            except (ValueError, TypeError) as e: error('entity_schema', f'{collection}: {e}', entity_id=key)
    try: validate_state(state, videos, visible_only=True)
    except (ValueError, TypeError, KeyError, IndexError) as e: error('domain_integrity', str(e))
    check('Boxes, classes, identities, segments, gaps and links', before)
    before = len(errors)
    annotated = {o.get('identity_uuid') for o in state.get('observations', {}).values() if o.get('person_visible') or o.get('person_ext')}
    ids = {}
    for ident in annotated:
        person = state.get('identities', {}).get(ident, {})
        number = person.get('person_id')
        first_frame = min(o['frame_index'] for o in state['observations'].values() if o.get('identity_uuid') == ident and (o.get('person_visible') or o.get('person_ext')))
        if type(number) is not int or number <= 0:
            error('missing_person_id', 'Assign a positive numeric person ID before finishing.', identity_uuid=ident, frame_index=first_frame)
        elif number in ids:
            error('duplicate_person_id', f'Person ID {number} belongs to more than one identity.', identity_uuid=ident, person_id=number, frame_index=first_frame)
        else: ids[number] = ident
    check('Positive unique person IDs', before)
    before = len(errors)
    times = {}
    for vid, video in videos.items():
        ledger = ledgers.get(vid, [])
        if video.get('status') != 'ready': error('video_not_ready', 'The source video must finish indexing.', video_id=vid)
        count = video.get('frame_count', 0)
        if not isinstance(count, int) or count <= 0: error('frame_count', 'The source video has no valid frame count.', video_id=vid)
        if [f.get('frame_index') for f in ledger] != list(range(count)):
            error('frame_ledger', 'The frame ledger must contain every source frame once, in order.', video_id=vid)
        last = None
        for f in ledger:
            n = f.get('frame_index')
            try:
                if type(f['pts']) is not int or type(f['time_base_num']) is not int or type(f['time_base_den']) is not int or f['time_base_num'] <= 0 or f['time_base_den'] <= 0:
                    raise ValueError('Missing or invalid source timestamp')
                timestamp = Fraction(f['pts'] * f['time_base_num'], f['time_base_den'])
                seconds = f.get('seconds')
                if not isinstance(seconds, (float, int)) or not math.isfinite(seconds) or abs(float(timestamp)-seconds) > 1e-6:
                    raise ValueError('Seconds do not match source PTS and time base')
                if last is not None and timestamp <= last: raise ValueError('Source timestamps are not strictly increasing')
                times[(vid, n)] = float(timestamp); last = timestamp
            except (ValueError, TypeError, KeyError, ZeroDivisionError) as e:
                error('frame_timestamp', str(e), video_id=vid, frame_index=n)
    check('Complete source frame ledger and timestamps', before)
    before = len(errors)
    expected, expected_frames = {}, {}
    for o in state.get('observations', {}).values():
        vid, frame, ident = o.get('video_id'), o.get('frame_index'), o.get('identity_uuid')
        person = state.get('identities', {}).get(ident, {})
        number = person.get('person_id')
        common = (vid, frame, ident)
        expected_frames[common] = o
        for geometry, box_type in [('person_visible', 'person_visible'), ('person_ext', 'person_extended')]:
            box = o.get(geometry)
            if box is None: continue
            if not numeric_box(box): error('invalid_box', 'A box must have four finite numeric coordinates.', frame_index=frame, identity_uuid=ident)
            style = person.get('box_styles', {}).get(geometry, {})
            expected[(*common, box_type)] = {'observation_id': o.get('id'), 'person_id': number, 'box_xyxy': box,
                'class_name': style.get('class_name', person.get('class_name', 'person_visible') if geometry == 'person_visible' else 'person_extended'),
                'geometry_name': geometry, 'timestamp_seconds': times.get((vid, frame))}
        a, b = o.get('person_ext'), o.get('person_visible')
        if numeric_box(a) and numeric_box(b) and any((b[0] < a[0]-.01, b[1] < a[1]-.01, b[2] > a[2]+.01, b[3] > a[3]+.01)):
            warning('visible_outside_extended', 'The Visible box extends outside the Extended box. Check both edges.', frame_index=frame, identity_uuid=ident, person_id=number)
    seen = set()
    for row in document.get('annotation_index', []):
        key = (row.get('video_id'), row.get('frame_index'), row.get('identity_uuid'), row.get('box_type'))
        target = expected.get(key)
        if key in seen or target is None or any(row.get(k) != v for k, v in (target or {}).items()):
            error('annotation_index_mismatch', 'The exported box index differs from the saved annotations.', frame_index=row.get('frame_index'), identity_uuid=row.get('identity_uuid'))
        else:
            b = target['box_xyxy']
            if numeric_box(b) and row.get('box_xywh') != [b[0], b[1], b[2]-b[0], b[3]-b[1]]:
                error('annotation_xywh_mismatch', 'Exported xywh coordinates differ from xyxy.', frame_index=row.get('frame_index'))
        seen.add(key)
    if seen != set(expected): error('annotation_index_count', 'The exported box index does not cover every saved box exactly once.')
    seen_frames = set()
    for row in document.get('frame_annotations', []):
        key = (row.get('video_id'), row.get('frame_index'), row.get('identity_uuid'))
        o = expected_frames.get(key)
        if key in seen_frames or not o or row.get('observation_id') != o.get('id') or row.get('boxes') != {'person_visible': o.get('person_visible'), 'person_extended': o.get('person_ext')} or row.get('person_id') != state.get('identities', {}).get(key[2], {}).get('person_id') or row.get('timestamp_seconds') != times.get(key[:2]):
            error('paired_box_identity', 'The paired-box rows do not share the saved identity and observation.', frame_index=row.get('frame_index'))
        seen_frames.add(key)
    if seen_frames != set(expected_frames): error('paired_box_count', 'A paired-box row is missing or duplicated.')
    expected_summary = {'videos':len(videos),'people':len(state.get('identities',{})), 'observations':len(state.get('observations',{})),
                        'visible_boxes':sum(k[3]=='person_visible' for k in expected),'extended_boxes':sum(k[3]=='person_extended' for k in expected),
                        'frames_in_ledger':sum(len(v) for v in ledgers.values())}
    if any(document.get('summary',{}).get(k)!=v for k,v in expected_summary.items()):error('summary_counts', 'Exported summary counts differ from the saved annotations and frame ledger.')
    check('Exported index and paired-box identity consistency', before)
    if not annotated: warning('no_annotations', 'No person boxes are saved. Confirm that this is intentional for the chosen coverage.')
    for s in state.get('segments', {}).values():
        if s.get('status') == 'unresolved': warning('unresolved_segment', 'This segment’s real-world identity remains unresolved.', frame_index=s.get('start'), identity_uuid=s.get('identity_uuid'))
    for link in state.get('links', {}).values():
        if link.get('relation') == 'unresolved': warning('unresolved_link', 'A cross-camera identity link remains unresolved.')
    grouped_warnings = group_warnings(warnings)
    return {'passed': not errors, 'errors': errors, 'warnings': grouped_warnings, 'checks': checks,
            'summary': {'people': len(annotated), 'frames': sum(v.get('frame_count', 0) for v in videos.values()), 'boxes': len(expected),
                        'warning_occurrences': len(warnings), 'warning_groups':len(grouped_warnings),
                        'visible_boxes': sum(k[3] == 'person_visible' for k in expected), 'extended_boxes': sum(k[3] == 'person_extended' for k in expected)},
            'limitation': LIMITATION}
