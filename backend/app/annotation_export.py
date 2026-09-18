"""Versioned, media-free annotation document from one consistent SQLite snapshot."""
import json
from .db import connect, get_state, now
from .visibility import visibility_intervals


def annotation_document(pid, video_id=None):
    with connect() as c:
        c.execute('BEGIN')
        project = get_state(c, pid)
        frames = {vid: [json.loads(r['data']) for r in c.execute(
            'SELECT data FROM frames WHERE video_id=? ORDER BY frame_index', (vid,))]
            for vid in project['videos']}
        operations = [{**json.loads(r['data']), 'revision': r['revision'], 'recorded_at': r['created_at']}
                      for r in c.execute('SELECT data,revision,created_at FROM operations WHERE project_id=? ORDER BY revision', (pid,))]
        proposals = [json.loads(r['data']) for vid in project['videos'] for r in c.execute(
            'SELECT data FROM proposals WHERE video_id=? ORDER BY frame_index,id', (vid,))]
        proposal_frames = [dict(r) for vid in project['videos'] for r in c.execute(
            'SELECT video_id,cache_key,frame_index FROM proposal_frames WHERE video_id=? ORDER BY cache_key,frame_index', (vid,))]
        detector_jobs = [j for r in c.execute('SELECT data FROM jobs WHERE project_id=? ORDER BY rowid', (pid,))
                         if (j := json.loads(r['data'])).get('kind') == 'proposals']
        table = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='restored_history'").fetchone()
        restored = c.execute('SELECT data FROM restored_history WHERE project_id=?', (pid,)).fetchone() if table else None
        restored_history = json.loads(restored['data']) if restored else None
    if video_id is not None:
        if video_id not in project['videos']:raise ValueError('Video does not belong to this project')
        state=project['state']
        people={o['identity_uuid'] for col in ('observations','segments','intervals') for o in state[col].values() if o['video_id']==video_id}
        # Historical people are needed for deleted boxes and undo records too.
        for op in operations:
            for ch in op['changes']:
                for value in (ch.get('before'),ch.get('after')):
                    if value and value.get('video_id')==video_id and value.get('identity_uuid'):people.add(value['identity_uuid'])
        for col in ('observations','segments','intervals','reviews','proposal_reviews'):
            state[col]={key:value for key,value in state[col].items() if value['video_id']==video_id}
        state['identities']={key:value for key,value in state['identities'].items() if key in people}
        state['links']={key:value for key,value in state['links'].items() if value['source'] in state['identities'] and value['target'] in state['identities']}
        scoped_operations=[]
        for op in operations:
            changes=[]
            for ch in op['changes']:
                values=[v for v in (ch.get('before'),ch.get('after')) if v]
                if any(v.get('video_id')==video_id for v in values) or (ch['collection']=='identities' and ch['id'] in people) or (ch['collection']=='links' and any(v.get('source') in people and v.get('target') in people for v in values)):changes.append(ch)
            if changes:scoped_operations.append({**op,'changes':changes})
        operations=scoped_operations
        project['videos']={video_id:project['videos'][video_id]}
        frames={video_id:frames[video_id]}
        proposals=[p for p in proposals if p['video_id']==video_id]
        proposal_frames=[p for p in proposal_frames if p['video_id']==video_id]
        detector_jobs=[j for j in detector_jobs if j.get('video_id')==video_id]
        # Unfiltered restored history can contain annotations for other videos.
        restored_history=None
    state = project['state']
    timings = {vid: {f['frame_index']: f for f in ledger} for vid, ledger in frames.items()}
    annotation_index = []
    frame_annotations = []
    for o in sorted(state['observations'].values(), key=lambda o: (o['video_id'], o['frame_index'], o['identity_uuid'])):
        identity = state['identities'][o['identity_uuid']]
        common = {'observation_id': o['id'], 'video_id': o['video_id'], 'frame_index': o['frame_index'],
                  'timestamp_seconds': timings.get(o['video_id'], {}).get(o['frame_index'], {}).get('seconds'),
                  'identity_uuid': o['identity_uuid'], 'person_id': identity['person_id']}
        frame_annotations.append({**common, 'boxes': {'person_visible': o.get('person_visible'), 'person_extended': o.get('person_ext')}})
        for geometry, box_type in [('person_visible', 'person_visible'), ('person_ext', 'person_extended')]:
            box = o.get(geometry)
            if box is None:
                continue
            provenance = o.get('provenance', {}).get(geometry, {})
            generated = provenance.get('origin') == 'interpolated' and not provenance.get('human_corrected')
            style = identity.get('box_styles', {}).get(geometry, {})
            annotation_index.append({
                **common, 'box_type': box_type, 'geometry_name': geometry,
                'class_name': style.get('class_name', identity.get('class_name', 'person_visible') if geometry == 'person_visible' else 'person_extended'),
                'color': style.get('color', identity.get('color', '#baa7ff') if geometry == 'person_visible' else '#67e2b1'),
                'box_xyxy': box, 'box_xywh': [box[0], box[1], box[2]-box[0], box[3]-box[1]],
                'visibility': 'visible' if o.get('person_visible') else 'not_visible',
                'annotation_type': 'interpolated' if generated else 'keyframe',
                'origin': provenance.get('origin'), 'human_corrected': provenance.get('human_corrected', False),
                'protected_from_interpolation': o['review_state'] == 'approved' or not generated,
            })
    return {
        'format': 'frameinsight.annotations', 'schema_version': 2, 'exported_at': now(),
        'media_included': False, 'video_scope': video_id, 'classes': project.get('classes', []), 'class_colors': project.get('class_colors', {}),
        'project': {k: project[k] for k in ('id', 'name', 'revision', 'created_at')},
        'conventions': {
            'active_classes': sorted({row['class_name'] for row in annotation_index}) or project.get('classes') or ['person_visible'],
            'coordinates': {'units': 'original_image_pixels', 'origin': 'top_left',
                            'xyxy': ['left', 'top', 'right', 'bottom'], 'xywh': ['left', 'top', 'width', 'height'],
                            'x_direction': 'right', 'y_direction': 'down', 'rounded': False},
            'frame_indices': 'zero_based_source_frames', 'interval_bounds': 'inclusive; null end means open',
            'timestamps': 'seconds in source stream; pts * time_base_num / time_base_den',
            'null_values': 'unknown or not specified; never inferred as false',
            'scope': 'All saved project annotations, including drafts and incomplete or single-person work.',
            'absence': 'Under the no-box visibility policy, any frame without this person’s box is labelled not_visible, including before/after appearances. This is annotation state, not proof of physical occlusion or exhaustive review; reason stays unknown unless explicitly recorded.',
            'review': 'Individual approvals are not required in the visible-only workflow; reviews record separate whole-frame checks.',
            'box_types': 'person_visible and person_extended are independently annotated rectangles of one identity. Internal person_ext stores the extended rectangle. Extended boxes do not establish visible evidence.',
            'annotation_index_key': 'video_id, frame_index, identity_uuid, box_type; observation_id is shared by paired boxes',
            'frame_annotations': 'One row per person per frame with both box slots; null means no box of that type.',
            'source_references': 'Video names, hashes and paths are metadata only. No video, image, thumbnail or binary media is embedded.',
            'history_scope': 'Selected-video changes only; project backups preserve full replayable history.' if video_id else 'Full project history.',
            'history': 'Operations preserve before/after values and undo links. recorded_at is server UTC time; no annotator identity is invented.',
        },
        'summary': {'videos': len(project['videos']), 'people': len(state['identities']),
                    'observations': len(state['observations']),
                    'visible_boxes': sum(o.get('person_visible') is not None for o in state['observations'].values()),
                    'extended_boxes': sum(o.get('person_ext') is not None for o in state['observations'].values()),
                    'frames_in_ledger': sum(map(len, frames.values())),
                    'whole_frames_checked': sum(bool(r['complete']) for r in state['reviews'].values()),
                    'operations': len(operations)},
        'videos': project['videos'], 'frames': frames,
        'annotation_index': annotation_index, 'frame_annotations': frame_annotations, 'visibility_intervals': visibility_intervals(state, project['videos']),
        'state': state, 'operations': operations, 'restored_history': restored_history,
        'detector': {'proposals': proposals, 'processed_frames': proposal_frames, 'jobs': detector_jobs},
    }
