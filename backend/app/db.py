import json
import colorsys
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from .config import DB
from .schema import MODELS, Operation, validate_state
LOCK = threading.RLock()

def class_palette(names, existing=None):
    palette = dict(existing or {})
    for name in dict.fromkeys([*(names or ['Person']), 'person_visible', 'person_extended']):
        if name in palette:
            continue
        # Sample several bright colors and keep the most distinct candidate.
        def rgb(color): return tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
        candidates = [tuple(round(c * 255) for c in colorsys.hsv_to_rgb(secrets.randbelow(3600)/3600, .55, .95)) for _ in range(32)]
        used = [rgb(c) for c in palette.values()]
        chosen = max(candidates, key=lambda c: min((sum((a-b)**2 for a,b in zip(c,u)) for u in used), default=0))
        palette[name] = '#%02x%02x%02x' % chosen
    return palette

def now(): return datetime.now(timezone.utc).isoformat()
def connect():
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA journal_mode=WAL')
    return c
@contextmanager
def transaction():
    with LOCK:
        c = connect()
        try:
            c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally: c.close()

def init():
    with transaction() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS frames(video_id TEXT NOT NULL REFERENCES videos(id), frame_index INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(video_id,frame_index));
        CREATE TABLE IF NOT EXISTS entities(project_id TEXT NOT NULL REFERENCES projects(id), collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id,collection,id));
        CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, video_id TEXT NOT NULL, frame_index INTEGER NOT NULL, cache_key TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS proposal_frame ON proposals(video_id,frame_index);
        CREATE TABLE IF NOT EXISTS proposal_frames(video_id TEXT NOT NULL, cache_key TEXT NOT NULL, frame_index INTEGER NOT NULL, PRIMARY KEY(video_id,cache_key,frame_index));
        CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
        ''')
        if 'classes' not in {r['name'] for r in c.execute('PRAGMA table_info(projects)')}:
            c.execute("ALTER TABLE projects ADD COLUMN classes TEXT NOT NULL DEFAULT '[]'")
        if 'class_colors' not in {r['name'] for r in c.execute('PRAGMA table_info(projects)')}:
            c.execute("ALTER TABLE projects ADD COLUMN class_colors TEXT NOT NULL DEFAULT '{}'")
            for row in c.execute('SELECT id,classes FROM projects').fetchall():
                styles = {}
                for entity in c.execute("SELECT data FROM entities WHERE project_id=? AND collection='identities'", (row['id'],)):
                    person = json.loads(entity['data'])
                    if person.get('class_name') and person.get('color'):
                        styles.setdefault(person['class_name'], person['color'])
                    for style in person.get('box_styles', {}).values():
                        styles.setdefault(style['class_name'], style['color'])
                palette = class_palette(json.loads(row['classes']), styles)
                c.execute('UPDATE projects SET class_colors=? WHERE id=?', (json.dumps(palette), row['id']))
        c.execute('INSERT OR IGNORE INTO migrations VALUES(1,?)', (now(),))
        c.execute('INSERT OR IGNORE INTO migrations VALUES(2,?)', (now(),))
        if not c.execute('SELECT 1 FROM migrations WHERE version=3').fetchone():
            # A completed legacy pass proves every frame was processed, including
            # frames with zero detections. Partial legacy jobs must be re-run.
            for row in c.execute('SELECT data FROM jobs').fetchall():
                job = json.loads(row['data'])
                if job.get('kind') == 'proposals' and job.get('status') == 'completed' and job.get('cache_key'):
                    c.executemany('INSERT OR IGNORE INTO proposal_frames VALUES(?,?,?)', ((job['video_id'], job['cache_key'], n) for n in range(job['total'])))
            c.execute('INSERT INTO migrations VALUES(3,?)', (now(),))

def get_state(c, pid):
    p = c.execute('SELECT * FROM projects WHERE id=?', (pid,)).fetchone()
    if not p: raise KeyError('Project not found')
    state = {key: {} for key in MODELS}
    for row in c.execute('SELECT collection,id,data FROM entities WHERE project_id=?', (pid,)):
        state[row['collection']][row['id']] = json.loads(row['data'])
    videos = {r['id']: json.loads(r['data']) for r in c.execute('SELECT id,data FROM videos WHERE project_id=?', (pid,))}
    return {**dict(p), 'classes': json.loads(p['classes']), 'class_colors': json.loads(p['class_colors']), 'schema_version': 1, 'state': state, 'videos': videos}

def snapshot(pid):
    with connect() as c: return get_state(c, pid)

def apply(pid, operation: Operation):
    with transaction() as c:
        old = c.execute('SELECT project_id,revision,data FROM operations WHERE id=?', (operation.id,)).fetchone()
        if old:
            previous = json.loads(old['data'])
            if old['project_id'] != pid or previous != operation.model_dump(mode='json'):
                raise ValueError('Operation ID was reused with different content')
            return {'revision': old['revision'], 'duplicate': True}
        project = get_state(c, pid)
        if operation.base_revision != project['revision']: raise Conflict(project['revision'])
        state = project['state']
        compensating = False
        if operation.compensates:
            row = c.execute('SELECT data FROM operations WHERE id=? AND project_id=?', (operation.compensates, pid)).fetchone()
            if not row: raise ValueError('Compensated operation does not exist')
            original = json.loads(row['data'])
            inverse = [{**ch, 'before': ch['after'], 'after': ch['before']} for ch in original['changes']]
            if inverse != [ch.model_dump(mode='json') for ch in operation.changes]: raise ValueError('Compensation must exactly reverse the original operation')
            compensating = True
        touched = set()
        changed_identity = set()
        for change in operation.changes:
            if state[change.collection].get(change.id) != change.before: raise Conflict(project['revision'])
            if change.after is None: state[change.collection].pop(change.id, None)
            else:
                value = MODELS[change.collection].model_validate(change.after).model_dump(mode='json', exclude_unset=change.collection in ('identities', 'intervals'))
                if value['id'] != change.id: raise ValueError('Entity ID mismatch')
                state[change.collection][change.id] = value
            if change.collection == 'observations':
                for value in (change.before, change.after):
                    if value: touched.add((value['video_id'], value['frame_index']))
                if change.before and change.after and change.before['review_state'] == 'approved':
                    relevant = [k for k in change.after if k != 'review_state']
                    if any(change.before.get(k) != change.after[k] for k in relevant) and change.after['review_state'] == 'approved' and not compensating:
                        raise ValueError('Editing an approved observation must downgrade it to draft')
            if change.collection == 'identities' and change.before != change.after: changed_identity.add(change.id)
        for o in state['observations'].values():
            if o['identity_uuid'] in changed_identity:
                touched.add((o['video_id'], o['frame_index']))
                if o['review_state'] == 'approved' and not compensating: raise ValueError('Identity changes must downgrade affected approvals')
        for r in state['reviews'].values():
            if (r['video_id'], r['frame_index']) in touched and r['complete'] and not compensating:
                raise ValueError('Annotation changes must invalidate frame completeness')
        for change in operation.changes:
            if change.collection=='proposal_reviews' and change.after:
                e=change.after
                row=c.execute('SELECT video_id,frame_index FROM proposals WHERE id=?',(e['proposal_id'],)).fetchone()
                if not row or row['video_id']!=e['video_id'] or row['frame_index']!=e['frame_index']: raise ValueError('Proposal review must reference its original video/frame')
        validate_state(state, project['videos'], visible_only=True)
        for change in operation.changes:
            value = state[change.collection].get(change.id)
            if value is None: c.execute('DELETE FROM entities WHERE project_id=? AND collection=? AND id=?', (pid, change.collection, change.id))
            else: c.execute('INSERT OR REPLACE INTO entities VALUES(?,?,?,?)', (pid, change.collection, change.id, json.dumps(value)))
        revision = project['revision'] + 1
        c.execute('UPDATE projects SET revision=? WHERE id=?', (revision, pid))
        c.execute('INSERT INTO operations VALUES(?,?,?,?,?)', (operation.id, pid, revision, operation.model_dump_json(), now()))
        return {'revision': revision, 'duplicate': False}

class Conflict(Exception):
    def __init__(self, revision): self.revision = revision

def update_video(vid, **updates):
    with transaction() as c:
        row = c.execute('SELECT data FROM videos WHERE id=?', (vid,)).fetchone()
        data = json.loads(row['data']); data.update(updates)
        c.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(data), vid))
        return data

def job_update(jid, **updates):
    with transaction() as c:
        row = c.execute('SELECT data FROM jobs WHERE id=?', (jid,)).fetchone()
        data = json.loads(row['data']); data.update(updates); data['updated_at'] = now()
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(data), jid))
        return data

def job_get(jid):
    with connect() as c:
        row = c.execute('SELECT data FROM jobs WHERE id=?', (jid,)).fetchone()
        if not row: raise KeyError('Job not found')
        return json.loads(row['data'])
