import copy
import json
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from defusedxml.ElementTree import fromstring
from .config import DATA
from .geometry import reject_dynamic
from .db import snapshot, connect, transaction, now, job_update
from .schema import issues, MODELS, validate_state

def native_manifest(project):
    with connect() as c:
        frames = {v: [json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index', (v,))] for v in project['videos']}
        operations = [json.loads(r['data']) for r in c.execute('SELECT data FROM operations WHERE project_id=? ORDER BY revision', (project['id'],))]
        proposals = [json.loads(r['data']) for v in project['videos'] for r in c.execute('SELECT data FROM proposals WHERE video_id=?', (v,))]
        table = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='restored_history'").fetchone()
        row = c.execute('SELECT data FROM restored_history WHERE project_id=?', (project['id'],)).fetchone() if table else None
        restored_history = json.loads(row['data']) if row else None
        settings_history = [json.loads(row['data']) for row in c.execute('SELECT data FROM project_settings_events WHERE project_id=? ORDER BY revision', (project['id'],))]
    # File references are informational only on import, never used as write paths.
    return {**project, 'format': 'frameinsight', 'exported_at': now(), 'frames': frames, 'operations': operations, 'proposals': proposals, 'restored_history': restored_history, 'project_settings_history': settings_history}

def cvat_xml(project, vid, *, visible_only=False):
    state = project['state']; video = project['videos'][vid]
    reject_dynamic(o for o in state['observations'].values() if o['video_id'] == vid)
    root = ET.Element('annotations'); ET.SubElement(root, 'version').text = '1.1'
    meta = ET.SubElement(root, 'meta'); task = ET.SubElement(meta, 'task')
    for name, val in {'id': 0, 'name': video['name'], 'size': video['frame_count'], 'mode': 'interpolation', 'start_frame': 0, 'stop_frame': video['frame_count']-1, 'frame_filter': '', 'overlap': 0, 'flipped': 'False'}.items(): ET.SubElement(task, name).text = str(val)
    size = ET.SubElement(task, 'original_size')
    ET.SubElement(size, 'width').text = str(video['width']); ET.SubElement(size, 'height').text = str(video['height'])
    labels = ET.SubElement(task, 'labels')
    attrs = {'person_id': False, 'identity_uuid': False, 'full_quality': True, 'truncated': True, 'evidence_note': True, 'observation_id': True, 'review_state': True, 'geometry_link': True}
    for geometry in (('person_visible',) if visible_only else ('person_ext', 'person_visible')):
        label = ET.SubElement(labels, 'label'); ET.SubElement(label, 'name').text = geometry
        ET.SubElement(label, 'color').text = '#61d9b6' if geometry == 'person_ext' else '#b7a0ff'
        attributes = ET.SubElement(label, 'attributes')
        for name, mutable in attrs.items():
            a = ET.SubElement(attributes, 'attribute')
            for key, val in {'name': name, 'mutable': str(mutable), 'input_type': 'text', 'default_value': '', 'values': ''}.items(): ET.SubElement(a, key).text = val
    track_id = 0
    for ident in state['identities'].values():
        obs = sorted([o for o in state['observations'].values() if o['video_id'] == vid and o['identity_uuid'] == ident['id']], key=lambda o:o['frame_index'])
        if not obs: continue
        if ident['person_id'] is None: raise ValueError('CVAT export requires numeric IDs. Assign IDs or export native.')
        for geometry in (('person_visible',) if visible_only else ('person_ext', 'person_visible')):
            present = [o for o in obs if o[geometry] is not None]
            if not present: continue
            track = ET.SubElement(root, 'track', id=str(track_id), label=geometry, source='manual'); track_id += 1
            for idx, o in enumerate(present):
                a = o[geometry]
                def box(frame, outside):
                    b = ET.SubElement(track, 'box', frame=str(frame), outside=str(outside), occluded=str(int(o['occluded'] is True)), keyframe='1', xtl=str(a[0]), ytl=str(a[1]), xbr=str(a[2]), ybr=str(a[3]), z_order='0')
                    values = {'person_id': ident['person_id'], 'identity_uuid': ident['id'], 'full_quality': o['full_quality'], 'truncated': str(o['truncated']), 'evidence_note': o['evidence_note'], 'observation_id': o['id'], 'review_state': o['review_state'], 'geometry_link': o['geometry_link']}
                    for name, value in values.items(): ET.SubElement(b, 'attribute', name=name).text = str(value)
                box(o['frame_index'], 0)
                nxt = present[idx+1]['frame_index'] if idx+1 < len(present) else video['frame_count']
                if nxt > o['frame_index']+1: box(o['frame_index']+1, 1)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)

def yolo_rows(obs, width, height, profile):
    reject_dynamic(obs)
    rows, pairs = [], []
    geometries = {'dual_class': [('person_ext', 0), ('person_visible', 1)], 'full_only': [('person_ext', 0)], 'visible_only': [('person_visible', 0)]}[profile]
    for o in obs:
        for name, cls in geometries:
            b = o[name]
            if b is None: raise ValueError(f'{profile} requires {name}')
            x1,y1,x2,y2=b
            rows.append(f'{cls} {(x1+x2)/2/width:.9f} {(y1+y2)/2/height:.9f} {(x2-x1)/width:.9f} {(y2-y1)/height:.9f}')
            pairs.append({'line': len(rows)-1, 'observation_id': o['id'], 'identity_uuid': o['identity_uuid'], 'geometry': name})
    return '\n'.join(rows) + ('\n' if rows else ''), pairs

def export_project(pid, settings, jid):
    try:
        job_update(jid, status='running')
        if settings['format'] == 'annotations_json':
            from .review_delivery import validated_document, validation_proof
            from .video import sha256
            document = validated_document(pid, settings)
            eid = str(uuid.uuid4()); path = DATA / 'exports' / f'{eid}.json'
            path.write_text(json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False), encoding='utf-8')
            data = {'id': eid, 'project_id': pid, 'path': str(path), 'revision': document['project']['revision'],
                    'settings': {**settings, 'include_videos': False}, 'included_images': 0, 'excluded_frames': 0, 'created_at': now(), 'file_hash':sha256(path)}
            with transaction() as c:
                validation_proof(pid,settings,c)
                c.execute('INSERT INTO exports VALUES(?,?,?)', (eid, pid, json.dumps(data)))
            job_update(jid, status='completed', export_id=eid, progress=1, total=1)
            return
        project = snapshot(pid); native = native_manifest(project)
        eid = str(uuid.uuid4()); path = DATA / 'exports' / f'{eid}.zip'
        profile = settings['format']; exclusions = []; included = 0
        if profile != 'native': reject_dynamic(project['state']['observations'].values())
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('native/project.json', json.dumps(native, indent=2))
            z.writestr('settings.json', json.dumps(settings, indent=2))
            if profile == 'native':
                if settings.get('include_videos'):
                    for v in project['videos'].values(): z.write(v['source'], f'originals/{v["id"]}{Path(v["source"]).suffix}')
            elif profile == 'cvat':
                for vid in project['videos']: z.writestr(f'{vid}/annotations.xml', cvat_xml(project, vid, visible_only=True))
            elif profile in ('dual_class', 'full_only', 'visible_only'):
                state = project['state']; pairs = {}; frame_map = []; processed = 0
                total_frames = sum(v['frame_count'] for v in project['videos'].values())
                for vid, v in project['videos'].items():
                    if v['status'] != 'ready': raise ValueError('Finish indexing all videos before dataset export')
                    for f in range(v['frame_count']):
                        if processed % 10 == 0: job_update(jid, progress=processed, total=total_frames)
                        processed += 1
                        obs = [o for o in state['observations'].values() if o['video_id']==vid and o['frame_index']==f]
                        review = next((r for r in state['reviews'].values() if r['video_id']==vid and r['frame_index']==f), None)
                        reason = None
                        if not review or not review['complete']: reason = 'Frame is not reviewed-complete'
                        elif any((profile!='visible_only' and o['review_state'] != 'approved') or issues(o, visible_only=profile=='visible_only') or state['segments'][o['segment_id']]['status']!='verified' for o in obs): reason = 'Unapproved or invalid observation'
                        elif profile != 'visible_only' and any(o['person_ext'] is None for o in obs): reason = 'Unknown full extent blocks this whole image'
                        elif any(state['segments'][o['segment_id']]['status'] != 'verified' for o in obs): reason = 'Unresolved identity'
                        if reason:
                            exclusions.append({'video_id':vid,'frame_index':f,'reason':reason}); continue
                        name = f'{vid}_{f:08d}'
                        labels, pair = yolo_rows(obs, v['width'], v['height'], profile)
                        # The project is one related recording group: no neighbour-frame random split.
                        split = settings.get('split', 'train')
                        z.write(DATA/'frames'/vid/f'{f:08d}.png', f'images/{split}/{name}.png', compress_type=zipfile.ZIP_STORED)
                        z.writestr(f'labels/{split}/{name}.txt', labels)
                        pairs[name] = pair
                        frame_map.append({'name':name,'video_id':vid,**native['frames'][vid][f]}); included += 1
                if included == 0: raise ValueError('No eligible images. Approve observations, check whole-frame completeness, and resolve profile issues.')
                classes = ['person_ext','person_visible'] if profile=='dual_class' else [ 'person_ext' if profile=='full_only' else 'person_visible']
                z.writestr('dataset.yaml', 'path: .\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n'+''.join(f'  {i}: {n}\n' for i,n in enumerate(classes)))
                z.writestr('pairs.json', json.dumps(pairs)); z.writestr('frame_mapping.json', json.dumps(frame_map))
                z.writestr('SPLITS.md', 'This archive assigns this entire project/recording group to one split. Combine independent groups into the other splits before training. Do not randomly split neighbouring frames.\n')
            elif profile == 'mot':
                if settings.get('mot_profile') != 'motchallenge-1based-unknown-visibility': raise ValueError('Select the documented MOTChallenge profile explicitly')
                geometry = settings.get('geometry', 'person_ext'); state = project['state']
                if any(l['relation']=='unresolved' for l in state['links'].values()): raise ValueError('Resolve identity links before MOT export')
                for vid,v in project['videos'].items():
                    if v['status'] != 'ready': raise ValueError('Indexing must finish before MOT export')
                    reviews = {r['frame_index']:r for r in state['reviews'].values() if r['video_id']==vid}
                    if any(not reviews.get(f,{}).get('complete') for f in range(v['frame_count'])): raise ValueError('MOT requires a continuous, completely reviewed clip; every source frame must be checked')
                    rows=[]
                    for o in sorted(state['observations'].values(), key=lambda o:o['frame_index']):
                        if o['video_id']!=vid: continue
                        ident=state['identities'][o['identity_uuid']]
                        if (geometry!='person_visible' and o['review_state']!='approved') or ident['person_id'] is None or o[geometry] is None or state['segments'][o['segment_id']]['status']!='verified': raise ValueError('MOT requires valid selected geometry and verified numeric identity on every visible observation')
                        x1,y1,x2,y2=o[geometry]
                        rows.append(f'{o["frame_index"]+1},{ident["person_id"]},{x1+1:.6f},{y1+1:.6f},{x2-x1:.6f},{y2-y1:.6f},1,1,-1')
                    z.writestr(f'{vid}/gt/gt.txt','\n'.join(rows)+'\n')
                    z.writestr(f'{vid}/seqinfo.ini',f'[Sequence]\nname={vid}\nimDir=img1\nframeRate={v["nominal_fps"]}\nseqLength={v["frame_count"]}\nimWidth={v["width"]}\nimHeight={v["height"]}\nimExt=.png\n')
                    z.writestr(f'{vid}/timing.json', json.dumps(native['frames'][vid]))
                    for f in range(v['frame_count']):
                        if f % 10 == 0: job_update(jid, progress=f, total=v['frame_count'])
                        z.write(DATA/'frames'/vid/f'{f:08d}.png', f'{vid}/img1/{f+1:06d}.png', compress_type=zipfile.ZIP_STORED)
                z.writestr('PROFILE.md','MOTChallenge-style 9 columns. Frame and xy origin are 1-based; class 1=pedestrian; confidence/mark=1; visibility=-1 means unavailable, never an area ratio. Use only an evaluator that accepts unknown visibility. Timing remains in timing.json; nominal FPS does not replace VFR timestamps. External evaluator certification is not claimed.\n')
            else: raise ValueError('Unknown export profile')
            z.writestr('exclusions.json',json.dumps(exclusions,indent=2))
            z.writestr('manifest.json',json.dumps({'schema_version':1,'project_id':pid,'revision':project['revision'],'format':profile,'included_images':included,'excluded_frames':len(exclusions)},indent=2))
        data={'id':eid,'project_id':pid,'path':str(path),'revision':project['revision'],'settings':settings,'included_images':included,'excluded_frames':len(exclusions),'created_at':now()}
        with transaction() as c: c.execute('INSERT INTO exports VALUES(?,?,?)',(eid,pid,json.dumps(data)))
        job_update(jid,status='completed',export_id=eid,progress=1,total=1)
    except Exception as e:
        if 'path' in locals(): path.unlink(missing_ok=True)
        job_update(jid,status='failed',error=str(e))

def parse_cvat(content, project, vid):
    """Import explicit boxes only. Sparse external tracks remain drafts; no guessed interpolation."""
    root=fromstring(content)
    if root.tag!='annotations': raise ValueError('Expected CVAT annotations XML')
    video=project['videos'][vid]; state=copy.deepcopy(project['state']); added=[]; warnings=[]; persons={}; observations={}; seen_geometry=set()
    size=root.find('./meta/task/original_size')
    if size is not None and (int(size.findtext('width','0'))!=video['width'] or int(size.findtext('height','0'))!=video['height']): raise ValueError('CVAT dimensions do not match the selected source video')
    for track in root.findall('track'):
        geometry=track.get('label')
        if geometry not in ('person_ext','person_visible'): warnings.append(f'Skipped unsupported label {geometry}'); continue
        fixed = {}
        for box in track.findall('box'):
            if box.get('outside')=='1': continue
            frame=int(box.get('frame')); attrs={a.get('name'):a.text or '' for a in box.findall('attribute')}
            if frame<0 or frame>=video['frame_count']: raise ValueError('CVAT frame exceeds decoded source ledger')
            for name in ('person_id','identity_uuid'):
                if name in attrs: fixed[name]=attrs[name]
                elif name in fixed: attrs[name]=fixed[name]
            pid=attrs.get('person_id'); numeric=int(pid) if pid and pid.isdigit() and int(pid)>0 else None
            key=f'person:{numeric}' if numeric is not None else f'unpaired-track:{track.get("id")}'
            if numeric is None: warnings.append('A track has no explicit numeric person_id; imported as an unpaired draft, never inferred from track ID')
            if key not in persons:
                if numeric is not None and any(i['person_id']==numeric for i in state['identities'].values()): raise ValueError(f'Person ID {numeric} already exists; import into a new project or resolve identity explicitly')
                identity=MODELS['identities'](id=str(uuid.uuid4()),person_id=numeric,name='Imported draft').model_dump()
                segment=MODELS['segments'](id=str(uuid.uuid4()),video_id=vid,identity_uuid=identity['id'],start=frame,status='unresolved' if numeric is None else 'verified').model_dump()
                persons[key]=(identity,segment)
            identity,segment=persons[key]; segment['start']=min(segment['start'],frame)
            pair=(key,frame)
            if (*pair,geometry) in seen_geometry: raise ValueError('Ambiguous A/B pairing: duplicate geometry for person and frame')
            seen_geometry.add((*pair,geometry))
            if pair not in observations:
                observations[pair]=MODELS['observations'](id=str(uuid.uuid4()),video_id=vid,frame_index=frame,identity_uuid=identity['id'],segment_id=segment['id']).model_dump(mode='json')
            o=observations[pair]
            o[geometry]=[float(box.get(k)) for k in ('xtl','ytl','xbr','ybr')]
            quality=attrs.get('full_quality','unset'); o['full_quality']=quality if quality in ('observed','estimated','unknown') else 'unset'
            o['occluded']=box.get('occluded')=='1'; o['truncated']={'True':True,'False':False,'true':True,'false':False}.get(attrs.get('truncated'))
            o['evidence_note']=attrs.get('evidence_note',''); o['review_state']='needs_review'
            o['provenance'][geometry]={'origin':'manual','proposal_id':None,'human_corrected':False}
    for identity,segment in persons.values():
        for col,value in [('identities',identity),('segments',segment)]: state[col][value['id']]=value; added.append({'collection':col,'id':value['id'],'before':None,'after':value})
    for o in observations.values():
        state['observations'][o['id']]=o; added.append({'collection':'observations','id':o['id'],'before':None,'after':o})
    validate_state(state,project['videos'],visible_only=True)
    return added, sorted(set(warnings))+['Imported keyframes require review. Outside markers are not positive boxes. Native sidecar retains original gaps, provenance and history.']
