"""Apply explicit, visually reviewed source-pixel decisions through the normal API.

This does not infer boxes, identities, quality, or completeness. Its JSON input is
an annotation decision record, authored after inspecting the exact source images.
All writes remain revision-checked and undoable in server operation history.
"""
import argparse,json,uuid,urllib.request
from pathlib import Path
BASE='http://127.0.0.1:8765/api'
def call(path,body=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
def apply_review(path):
    from backend.app.schema import Identity,Segment,Observation,Review
    spec=json.loads(Path(path).read_text());pid=spec['project_id'];vid=spec['video_id'];p=call('/projects/'+pid)
    def commit(label,changes,frame=None):
        nonlocal p
        if not changes:return
        call('/projects/'+pid+'/operations',{'id':str(uuid.uuid4()),'base_revision':p['revision'],'label':label,'video_id':vid,'frame_index':frame,'changes':changes})
        p=call('/projects/'+pid)
    people={i['person_id']:i for i in p['state']['identities'].values()};changes=[]
    for n in sorted({o['person_id'] for o in spec['observations']}):
        if n in people:continue
        ident=Identity(id=str(uuid.uuid4()),person_id=n,name=spec.get('names',{}).get(str(n),''));people[n]=ident.model_dump()
        changes.append({'collection':'identities','id':ident.id,'before':None,'after':ident.model_dump()})
        frames=[o['frame'] for o in spec['observations'] if o['person_id']==n]
        seg=Segment(id=str(uuid.uuid4()),video_id=vid,identity_uuid=ident.id,start=min(frames))
        changes.append({'collection':'segments','id':seg.id,'before':None,'after':seg.model_dump()})
    commit('Create identities from inspected source frames',changes)
    changes=[];observation_ids=[]
    for decision in spec['observations']:
        frame=decision['frame'];identity=people[decision['person_id']]['id']
        old=next((o for o in p['state']['observations'].values() if o['video_id']==vid and o['frame_index']==frame and o['identity_uuid']==identity),None)
        segment=next(s for s in p['state']['segments'].values() if s['video_id']==vid and s['identity_uuid']==identity and s['start']<=frame and (s['end'] is None or s['end']>=frame))
        a=decision.get('a');b=decision['b'];note=decision['note']
        provenance=decision.get('provenance',{g:{'origin':'manual','proposal_id':None,'human_corrected':False} for g,v in [('person_ext',a),('person_visible',b)] if v})
        value=Observation(id=old['id'] if old else str(uuid.uuid4()),video_id=vid,frame_index=frame,identity_uuid=identity,segment_id=segment['id'],person_ext=a,person_visible=b,full_quality=decision['quality'],occluded=decision['occluded'],truncated=decision['truncated'],geometry_link='equal' if a==b and a and not decision['occluded'] else 'independent',evidence_note=note,provenance=provenance).model_dump(mode='json')
        changes.append({'collection':'observations','id':value['id'],'before':old,'after':value});observation_ids.append(value['id'])
    touched={o['frame'] for o in spec['observations']}
    for review in p['state']['reviews'].values():
        if review['video_id']==vid and review['frame_index'] in touched and review['complete']:
            changes.append({'collection':'reviews','id':review['id'],'before':review,'after':{**review,'complete':False,'checked_all_people':False}})
    commit('Apply visually inspected annotation decisions: '+Path(path).name,changes,min(touched))
    if spec.get('approve',True):
        commit('Approve inspected observations: '+Path(path).name,[{'collection':'observations','id':oid,'before':p['state']['observations'][oid],'after':{**p['state']['observations'][oid],'review_state':'approved'}} for oid in observation_ids],min(touched))
    changes=[]
    for frame in spec.get('complete_frames',[]):
        ident=f'{vid}:{frame}';review=Review(id=ident,video_id=vid,frame_index=frame,complete=True,checked_all_people=True,note=spec['whole_frame_note']).model_dump()
        changes.append({'collection':'reviews','id':ident,'before':p['state']['reviews'].get(ident),'after':review})
    commit('Whole-image review: '+Path(path).name,changes,min(spec.get('complete_frames') or touched))
    print(json.dumps({'revision':p['revision'],'observations_written':len(observation_ids),'complete_frames':spec.get('complete_frames',[])}))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('decisions');args=parser.parse_args();apply_review(args.decisions)
