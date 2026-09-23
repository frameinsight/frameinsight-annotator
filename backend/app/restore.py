"""Restore native archives without extracting untrusted archive paths."""
import copy
import json
import shutil
import uuid
import zipfile
from pathlib import Path
from .config import DATA, WORKSPACE
from . import db
from .schema import MODELS, validate_state
from .video import index_video, sha256, new_job

def restore_archive(path, jid):
    try:
        db.job_update(jid,status='running')
        with zipfile.ZipFile(path) as archive:
            members=archive.infolist()
            if sum(m.file_size for m in members)>100*1024**3:raise ValueError('Archive exceeds 100 GB uncompressed limit')
            info=archive.getinfo('native/project.json')
            if info.file_size>200*1024**2:raise ValueError('Native metadata exceeds 200 MB limit')
            original=json.loads(archive.read(info))
            if original.get('format')!='frameinsight' or original.get('schema_version')!=1:raise ValueError('Unsupported native schema')
            classes=original.get('classes',[])
            if not isinstance(classes,list) or len(classes)>100 or any(not isinstance(name,str) or not name.strip() or len(name)>80 for name in classes):raise ValueError('Invalid class catalog in backup')
            pid=str(uuid.uuid4());mapping={};videos={}
            # Verify ALL originals before creating any restored project.
            sources={}
            for old,v in original['videos'].items():
                source=Path(v.get('source','')).resolve();digest=v.get('source_hash')
                if not digest:raise ValueError('Source hash missing: export after original hashing completes')
                if source.is_file() and (source.is_relative_to(WORKSPACE) or source.is_relative_to(DATA/'originals')) and sha256(source)==digest:sources[old]=source;continue
                member=next((m for m in members if m.filename.startswith(f'originals/{old}.')),None)
                if not member:raise ValueError(f'Missing source {v["name"]}. Include originals in the archive or restore the exact hashed source to its recorded location.')
                suffix=Path(member.filename).suffix
                if suffix not in ('.mp4','.avi','.mov','.mkv','.webm','.m4v'):raise ValueError('Invalid original video extension')
                dest=DATA/'originals'/f'restore-{uuid.uuid4()}{suffix}'
                with archive.open(member) as src,open(dest,'wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
                if sha256(dest)!=digest:dest.unlink();raise ValueError('Original video hash mismatch')
                sources[old]=dest
            palette=original.get('class_colors',{})
            if not isinstance(palette,dict) or any(not isinstance(k,str) or not isinstance(v,str) or len(v)!=7 or not v.startswith('#') or any(c not in '0123456789abcdefABCDEF' for c in v[1:]) for k,v in palette.items()):raise ValueError('Invalid class colors in backup')
            with db.transaction() as c:c.execute('INSERT INTO projects(id,name,created_at,classes,class_colors) VALUES(?,?,?,?,?)',(pid,original['name']+' (restored)',db.now(),json.dumps(original.get('classes',[])),json.dumps(db.class_palette(original.get('classes',[]),palette))))
            for old,v in original['videos'].items():
                vid=str(uuid.uuid4());mapping[old]=vid;new={**v,'id':vid,'project_id':pid,'status':'indexing','frame_count':0,'source':str(DATA/'originals'/(vid+sources[old].suffix))};videos[vid]=new
                # Review proofs belong to the original project/video snapshot.
                # A restored backup is editable work and must be reviewed again.
                for key in ('finished_revision','finished_at','validation_id','review_job_id','coverage','finish_confirmation'):new.pop(key,None)
                with db.transaction() as c:c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps(new)))
                sub=new_job(pid,'index',video_id=vid);index_video(vid,sources[old],Path(new['source']),sub['id'])
                if db.job_get(sub['id'])['status']!='completed':raise ValueError('Restored source failed indexing')
                with db.connect() as c:
                    indexed=[json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index',(vid,))]
                expected=original['frames'][old]
                if len(indexed)!=len(expected) or any((a['pts'],a['time_base_num'],a['time_base_den'])!=(b['pts'],b['time_base_num'],b['time_base_den']) for a,b in zip(indexed,expected,strict=True)):raise ValueError('Restored decoded frame ledger differs from archive')
            state={**{key:{} for key in MODELS},**copy.deepcopy(original['state'])}
            for col,entities in state.items():
                for e in entities.values():
                    if 'video_id' in e:e['video_id']=mapping[e['video_id']]
                    if col=='proposal_reviews':
                        e['proposal_id']=str(uuid.uuid5(uuid.NAMESPACE_URL,pid+e['proposal_id']))
                        e['id']=e['proposal_id']
                    if col=='observations':
                        for provenance in e.get('provenance',{}).values():
                            if provenance.get('proposal_id'): provenance['proposal_id']=str(uuid.uuid5(uuid.NAMESPACE_URL,pid+provenance['proposal_id']))
                if col=='proposal_reviews':
                    entities={e['id']:e for e in entities.values()};state[col]=entities
                if col=='reviews':
                    entities={e['video_id']+':'+str(e['frame_index']):{**e,'id':e['video_id']+':'+str(e['frame_index'])} for e in entities.values()};state[col]=entities
                for e in entities.values():MODELS[col].model_validate(e)
            current=db.snapshot(pid);validate_state(state,current['videos'],visible_only=True)
            with db.transaction() as c:
                for col,entities in state.items():
                    for ident,e in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,col,ident,json.dumps(e)))
                c.execute('CREATE TABLE IF NOT EXISTS restored_history(project_id TEXT PRIMARY KEY, data TEXT NOT NULL)')
                c.execute('INSERT INTO restored_history VALUES(?,?)',(pid,json.dumps({'source_project_id':original['id'],'source_revision':original['revision'],'operations':original.get('operations',[]),'previous_restored_history':original.get('restored_history')})))
                for p in original.get('proposals',[]):
                    p=copy.deepcopy(p);old_id=p['id'];p['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,pid+old_id));p['video_id']=mapping[p['video_id']]
                    # Keep an audit reference while live provenance uses remapped IDs.
                    p['original_proposal_id']=old_id
                    c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)',(p['id'],p['video_id'],p['frame_index'],p['cache_key'],json.dumps(p)))
            db.job_update(jid,status='completed',restored_project_id=pid,progress=1,total=1)
    except Exception as e:db.job_update(jid,status='failed',error=str(e))
