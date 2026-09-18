"""Read-only validation of the completed clip and its final export/restore artifacts."""
import copy
import hashlib
import json
import sqlite3
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path
import requests
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.schema import validate_state, issues, MODELS
from backend.app.formats import parse_cvat, native_manifest
from backend.app import db
PID = '5af0a853-e1db-4dc1-9966-5aa37f89e3b3'
API = 'http://127.0.0.1:8765/api'

def get(path):
    r=requests.get(API+path);r.raise_for_status();return r.json()
def digest(stream):
    h=hashlib.sha256()
    for block in iter(lambda:stream.read(4*1024*1024), b''): h.update(block)
    return h.hexdigest()

live=get('/projects/'+PID)
# Export archives are immutable. The user may continue editing the live project.
with zipfile.ZipFile(ROOT/'deliverables/OCCLUSION_01_cam01/annotations-native.zip') as archive:
    p=json.loads(archive.read('native/project.json'))
s=p['state'];obs=s['observations'];vid=next(iter(p['videos']));v=p['videos'][vid]
validate_state(s,p['videos'])
assert p['revision']==153
assert v['frame_count']==613
assert len(obs)==6904 and all(o['review_state']=='approved' and not issues(o) for o in obs.values())
assert {r['frame_index'] for r in s['reviews'].values() if r['complete'] and r['checked_all_people']}==set(range(613))
report={'project_id':PID,'revision':p['revision'],'live_project_revision_at_check':live['revision'],'live_project_differs_from_export':live['state']!=s,'source_hash':v['source_hash'],'frames':613,'approved_observations':len(obs),'identities':len(s['identities']),'segments':len(s['segments']),'invisible_intervals':len(s['intervals']),'unresolved_links':sum(l['relation']=='unresolved' for l in s['links'].values()),'unknown_full_extent':sum(o['full_quality']=='unknown' for o in obs.values()),'quality_counts':dict(Counter(o['full_quality'] for o in obs.values())),'archives':[]}
for profile,jid in json.loads((ROOT/'.frameinsight/review/final-export-jobs.json').read_text()).items():
    j=get('/jobs/'+jid)
    if j['status']!='completed': print(profile, j['status'], j.get('progress'));continue
    path=ROOT/'.frameinsight/exports'/(j['export_id']+'.zip')
    a={'profile':profile,'export_id':j['export_id'],'path':str(path),'size_bytes':path.stat().st_size}
    with zipfile.ZipFile(path) as z:
        n=json.loads(z.read('native/project.json'))
        assert n['state']==s and n['revision']==p['revision']
        assert len(n['frames'][vid])==613 and len(n['proposals'])==7820
        assert [f['frame_index'] for f in n['frames'][vid]]==list(range(613))
        assert json.loads(z.read('exclusions.json'))==[]
        a.update(revision=n['revision'],frame_ledger_count=613,proposal_count=len(n['proposals']),observation_count=len(obs),excluded_frames=0)
        if profile=='native':
            with z.open(next(name for name in z.namelist() if name.startswith('originals/'))) as f: assert digest(f)==v['source_hash']
            assert z.testzip() is None
            a['source_hash_verified']=True
        elif profile=='cvat':
            empty=copy.deepcopy(p);empty['state']={k:{} for k in MODELS}
            changes,warnings=parse_cvat(z.read(vid+'/annotations.xml'),empty,vid)
            identities={c['id']:c['after']['person_id'] for c in changes if c['collection']=='identities'}
            imported={(identities[c['after']['identity_uuid']],c['after']['frame_index']):c['after'] for c in changes if c['collection']=='observations'}
            assert len(imported)==len(obs)
            for o in obs.values():
                r=imported[(s['identities'][o['identity_uuid']]['person_id'],o['frame_index'])]
                for key in ('person_ext','person_visible','full_quality','occluded','truncated','evidence_note'):assert r[key]==o[key],(key,o['id'])
            assert z.testzip() is None
            a.update(imported_observations=len(imported),all_geometry_and_metadata_equal=True)
        elif profile=='visible_only':
            pairs=json.loads(z.read('pairs.json'));mapping=json.loads(z.read('frame_mapping.json'))
            assert len(pairs)==len(mapping)==613
            images=[name for name in z.namelist() if name.startswith('images/')]
            assert len(images)==613
            max_error=0;targets=0
            for f in mapping:
                name=f['name'];assert f['pts']==n['frames'][vid][f['frame_index']]['pts']
                rows=z.read('labels/train/'+name+'.txt').decode().splitlines();assert len(rows)==len(pairs[name])
                assert len(rows)==sum(o['frame_index']==f['frame_index'] for o in obs.values())
                for pair,row in zip(pairs[name],rows,strict=True):
                    cls,cx,cy,w,h=map(float,row.split());assert cls==0 and pair['geometry']=='person_visible'
                    o=obs[pair['observation_id']];assert o['frame_index']==f['frame_index'] and pair['identity_uuid']==o['identity_uuid']
                    box=[(cx-w/2)*v['width'],(cy-h/2)*v['height'],(cx+w/2)*v['width'],(cy+h/2)*v['height']]
                    max_error=max(max_error,*[abs(a-b) for a,b in zip(box,o['person_visible'])]);targets+=1
                data=z.read('images/train/'+name+'.png');assert struct.unpack('>II',data[16:24])==(2880,1620)
                with open(ROOT/'.frameinsight/frames'/vid/f"{f['frame_index']:08d}.png",'rb') as src:assert hashlib.sha256(data).hexdigest()==digest(src)
            assert targets==6904 and max_error<0.00001
            a.update(images=613,targets=targets,all_image_hashes_verified=True,max_coordinate_error_pixels=max_error,tolerance_pixels=0.00001)
    report['archives'].append(a)
    print('verified',profile,flush=True)

restore_job=get('/jobs/'+json.loads((ROOT/'.frameinsight/review/native-restore-job.json').read_text())['id'])
report['restore']={'job_id':restore_job['id'],'status':restore_job['status']}
if restore_job['status']=='completed':
    restored=get('/projects/'+restore_job['restored_project_id']);rv=next(iter(restored['videos']))
    rn=native_manifest(restored)
    assert restored['videos'][rv]['source_hash']==v['source_hash'] and restored['videos'][rv]['frame_count']==613
    with zipfile.ZipFile(next(a['path'] for a in report['archives'] if a['profile']=='native')) as z:original=json.loads(z.read('native/project.json'))
    assert rn['frames'][rv]==original['frames'][vid]
    assert rn['restored_history']['operations']==original['operations']
    state=copy.deepcopy(restored['state'])
    for col,values in state.items():
        for e in values.values():
            if 'video_id' in e:e['video_id']=vid
            if col=='observations':
                # Restored proposals intentionally receive fresh IDs; compare other provenance exactly.
                for g,provenance in e['provenance'].items():
                    if provenance.get('proposal_id'):provenance['proposal_id']=s[col][e['id']]['provenance'][g]['proposal_id']
        if col=='reviews':state[col]={vid+':'+str(e['frame_index']):{**e,'id':vid+':'+str(e['frame_index'])} for e in values.values()}
        elif col=='proposal_reviews':
            assert len(values)==len(s[col]);continue
        assert state[col]==s[col],col
    assert len(rn['proposals'])==7820
    for frame in range(613):
        with open(ROOT/'.frameinsight/frames'/vid/f'{frame:08d}.png','rb') as a,open(ROOT/'.frameinsight/frames'/rv/f'{frame:08d}.png','rb') as b:assert digest(a)==digest(b)
    report['restore'].update(project_id=restored['id'],video_id=rv,source_hash_verified=True,all_613_redecoded_frame_hashes_equal=True,ledger_equal=True,annotations_equal=True,history_equal=True,proposals=7820)
    print('verified native restore',flush=True)
report['cvat_server']=json.loads((ROOT/'docs/cvat-server-roundtrip.json').read_text())
(ROOT/'docs/artifact-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='archives'},indent=2))
if len(report['archives'])!=3 or report['restore']['status']!='completed': sys.exit(2)
