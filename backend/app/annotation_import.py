"""Bounded, read-only previews for YOLO detection and CVAT MOT 1.1 imports."""
import io
import math
import re
import uuid
import zipfile
from pathlib import PurePosixPath
import yaml
from .schema import Identity, Segment, Observation

LIMIT = 50 * 1024 * 1024
COLORS = ['#a3e635', '#38bdf8', '#fb923c', '#c084fc', '#2dd4bf', '#facc15']
MOT_CLASSES = ['pedestrian', 'person_on_vehicle', 'car', 'bicycle', 'motorbike', 'non_motorized_vehicle', 'static_person', 'distractor', 'occluder', 'occluder_on_ground', 'occluder_full', 'reflection']


def integer(value, name):
    try:
        number = float(value)
        if not math.isfinite(number) or not number.is_integer() or abs(number) > 9007199254740991:
            raise ValueError()
        return int(number)
    except (ValueError, OverflowError):
        raise ValueError(f'{name} must be an integer: {value}') from None


def files_from(raw, filename):
    if len(raw) > LIMIT:
        raise ValueError('Annotation upload limit is 50 MB')
    if not zipfile.is_zipfile(io.BytesIO(raw)):
        if filename.lower().endswith('.zip'):
            raise ValueError('This is not a readable ZIP archive')
        return {PurePosixPath(filename).name: raw.decode('utf-8-sig')}
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) > 30000:
            raise ValueError('Archive contains too many files')
        total = 0
        for item in entries:
            name = item.filename.replace('\\', '/')
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or ':' in name or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe archive path')
            if item.is_dir() or path.suffix.lower() not in ('.txt', '.names', '.yaml', '.yml'):
                continue
            total += item.file_size
            if total > 64 * 1024 * 1024 or item.file_size > LIMIT or item.flag_bits & 1:
                raise ValueError('Archive text is too large or encrypted')
            if name in result:
                raise ValueError('Duplicate archive filename')
            result[name] = archive.read(item).decode('utf-8-sig')
    return result


def preview(raw, filename, project, video_id, format='yolo', frame_base=0, coordinate_base=0, class_names=None, clip_boxes=False):
    if format == 'frameinsight':
        from .native_annotations import preview_native
        return preview_native(raw, project, video_id)
    if format not in ('yolo', 'yolo_tracks', 'mot') or frame_base not in (0, 1) or coordinate_base not in (0, 1):
        raise ValueError('Choose a supported format and frame/coordinate base')
    video = project['videos'].get(video_id)
    if not video or video['status'] != 'ready':
        raise ValueError('Wait until the selected video is ready')
    files = files_from(raw, filename)
    names = class_names
    if names is None:
        candidates = [v for k, v in files.items() if PurePosixPath(k).name in ('obj.names', 'classes.txt', 'labels.txt')]
        if len(candidates) > 1 and len(set(candidates)) > 1:
            raise ValueError('Conflicting class lists. Enter the class names explicitly.')
        if candidates:
            names = [line.strip() for line in candidates[0].splitlines() if line.strip()]
        else:
            metadata = [v for k, v in files.items() if PurePosixPath(k).suffix in ('.yaml', '.yml')]
            for value in metadata:
                if len(value) > 100000:
                    raise ValueError('Dataset YAML is too large')
                try:
                    data = yaml.safe_load(value)
                except yaml.YAMLError:
                    raise ValueError('Invalid dataset YAML') from None
                candidate = data.get('names') if isinstance(data, dict) else None
                if isinstance(candidate, dict):
                    if set(candidate) != set(range(len(candidate))):
                        raise ValueError('YAML class IDs must start at zero with no gaps')
                    candidate = [candidate[i] for i in range(len(candidate))]
                if candidate is not None:
                    if names is not None and names != candidate:
                        raise ValueError('Conflicting YAML class lists')
                    names = candidate
    if names is None:
        names = MOT_CLASSES if format == 'mot' else project.get('classes', [])
    if not isinstance(names, list) or not names or len(names) > 100 or any(not isinstance(n, str) or not n.strip() or len(n.strip()) > 80 for n in names):
        raise ValueError('Supply 1–100 class names in source class-ID order')
    names = [n.strip() for n in names]
    if len(set(names)) != len(names):
        raise ValueError('Class names must be unique')
    rows, ignored, clipped = [], 0, 0
    seen = set()
    def add(frame, source_id, cls, box, note=''):
        nonlocal clipped
        if not 0 <= frame < video['frame_count']:
            raise ValueError(f'Frame {frame} is outside this video. Check the frame numbering option.')
        if not 0 <= cls < len(names):
            raise ValueError(f'Unknown class ID {cls}; check the class list')
        if not all(math.isfinite(n) for n in box) or box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError(f'Invalid box on frame {frame}')
        bounded = [max(0, min(video['width'], box[0])), max(0, min(video['height'], box[1])), max(0, min(video['width'], box[2])), max(0, min(video['height'], box[3]))]
        if bounded != box:
            if not clip_boxes:
                raise ValueError(f'Box outside the image on frame {frame}. Enable clipping only if intended.')
            if bounded[2] <= bounded[0] or bounded[3] <= bounded[1]:
                raise ValueError(f'Box is completely outside the image on frame {frame}')
            box = bounded
            clipped += 1
        token = (frame, source_id, cls)
        if token in seen:
            raise ValueError(f'Duplicate box for one track/class on frame {frame}')
        seen.add(token)
        rows.append((frame, source_id, cls, box, note))
        if len(rows) > 45000:
            raise ValueError('Import at most 45,000 boxes at a time')
    if format == 'mot':
        candidates = [(k, v) for k, v in files.items() if PurePosixPath(k).name == 'gt.txt']
        if not candidates and len(files) == 1:
            candidates = list(files.items())
        if len(candidates) != 1:
            raise ValueError('Choose one MOT sequence containing gt/gt.txt')
        for line_number, line in enumerate(candidates[0][1].splitlines(), 1):
            if not line.strip(): continue
            fields = line.strip().split(',')
            if len(fields) not in (9, 10):
                raise ValueError(f'MOT line {line_number}: expected 9 or 10 comma-separated fields')
            values = [float(v) for v in fields]
            if not all(math.isfinite(v) for v in values): raise ValueError('MOT values must be finite')
            frame, track = integer(fields[0], 'Frame') - frame_base, integer(fields[1], 'Track ID')
            if track <= 0: raise ValueError('MOT ground-truth track IDs must be positive')
            flag = integer(fields[6], 'Included flag')
            if flag not in (0, 1): raise ValueError('Use MOT ground truth, not scored tracking results')
            if not flag:
                ignored += 1
                continue
            cls = integer(fields[7], 'Class ID') - 1
            visibility = values[8]
            if visibility != -1 and not 0 <= visibility <= 1: raise ValueError('Visibility must be 0–1 or -1 for unknown')
            x, y, w, h = values[2:6]
            x -= coordinate_base; y -= coordinate_base
            add(frame, track, cls, [x, y, x+w, y+h], f'MOT visibility: {visibility}')
    else:
        frames = set()
        for path, content in files.items():
            name = PurePosixPath(path)
            if name.suffix.lower() != '.txt' or name.name in ('classes.txt', 'labels.txt', 'train.txt', 'val.txt', 'valid.txt', 'test.txt'): continue
            match = re.search(r'(\d+)$', name.stem)
            if not match: raise ValueError(f'{name.name}: label filenames must end in a frame number')
            frame = int(match[1]) - frame_base
            if frame in frames: raise ValueError(f'Multiple label files for frame {frame}; import one video at a time')
            frames.add(frame)
            if not 0 <= frame < video['frame_count']: raise ValueError('Label frame is outside this video; check frame numbering')
            for index, line in enumerate(content.splitlines()):
                if not line.strip(): continue
                fields = line.split()
                if len(fields) != (6 if format == 'yolo_tracks' else 5): raise ValueError(f'{name.name}, line {index+1}: wrong column count for selected YOLO format')
                cls = integer(fields[0], 'Class ID')
                cx, cy, w, h = map(float, fields[1:5])
                track = integer(fields[5], 'Track ID') if format == 'yolo_tracks' else f'{frame}:{index}'
                if isinstance(track, int) and track < 0: raise ValueError('YOLO track IDs cannot be negative')
                add(frame, track, cls, [(cx-w/2)*video['width'], (cy-h/2)*video['height'], (cx+w/2)*video['width'], (cy+h/2)*video['height']])
    if not rows: raise ValueError('No included boxes found in this annotation file')
    source_ids = list(dict.fromkeys(row[1] for row in rows))
    used = {p['person_id'] for p in project['state']['identities'].values()}
    reserved = {i for i in source_ids if isinstance(i, int) and i > 0 and i not in used}
    allocated = used | reserved
    mapping, identities, segments, observations = [], {}, {}, {}
    next_id = 1
    for source in source_ids:
        if source in reserved:
            number = source
        else:
            while next_id in allocated: next_id += 1
            number = next_id; allocated.add(number)
        mapping.append({'source': source, 'track_id': number})
        ident = str(uuid.uuid4()); segment = str(uuid.uuid4())
        identities[source] = Identity(id=ident, person_id=number, name=f'Track {number}').model_dump(mode='json')
        segments[source] = Segment(id=segment, video_id=video_id, identity_uuid=ident, start=video['frame_count'], end=0).model_dump(mode='json')
    for frame, source, cls, box, note in rows:
        identity, segment = identities[source], segments[source]
        name = names[cls]; key = 'class:' + name
        color = project.get('class_colors', {}).get(name, COLORS[cls % len(COLORS)])
        identity['box_styles'][key] = {'class_name': name, 'color': color}
        identity['class_name'] = name; identity['color'] = color
        segment['start'] = min(segment['start'], frame); segment['end'] = max(segment['end'], frame)
        token = (source, frame)
        if token not in observations:
            observations[token] = Observation(id=str(uuid.uuid4()), video_id=video_id, identity_uuid=identity['id'], segment_id=segment['id'], frame_index=frame, evidence_note=f'Imported {format}. {note}').model_dump(mode='json')
        observation = observations[token]
        observation['boxes'][key] = box
        observation['provenance'][key] = {'origin': 'copied', 'proposal_id': None, 'human_corrected': False}
    if len(set(project.get('classes', [])) | {names[row[2]] for row in rows}) > 100:
        raise ValueError('Import would exceed the project limit of 100 classes')
    changes = [{'collection': collection, 'id': value['id'], 'before': None, 'after': value} for collection, values in [('identities', identities), ('segments', segments), ('observations', observations)] for value in values.values()]
    if len(changes) > 49000: raise ValueError('Too many imported entities; split this import into smaller parts')
    warnings = []
    if format == 'yolo': warnings.append('This YOLO file has no track IDs. Each detection becomes a separate track. Identities across frames cannot be recovered from these labels.')
    remapped = sum(isinstance(m['source'], int) and m['source'] != m['track_id'] for m in mapping)
    if remapped: warnings.append(f'{remapped} source IDs were reassigned to avoid merging with existing tracks or ID zero.')
    if clipped: warnings.append(f'{clipped} boxes were clipped to the image boundary.')
    if ignored: warnings.append(f'{ignored} MOT rows marked ignored were excluded.')
    return {'base_revision': project['revision'], 'changes': changes, 'classes': names, 'mapping': mapping, 'warnings': warnings, 'summary': {'boxes': len(rows), 'tracks': len(identities), 'frames': len({r[0] for r in rows}), 'first_frame': min(r[0] for r in rows), 'last_frame': max(r[0] for r in rows)}}
