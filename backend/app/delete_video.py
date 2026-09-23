"""Delete one imported video while preserving external files and other videos."""
import json
import shutil
from pathlib import Path
from fastapi import HTTPException
from . import db
from .config import DATA


def delete_video(vid):
    files = []
    with db.transaction() as c:
        row = c.execute('SELECT project_id,data FROM videos WHERE id=?', (vid,)).fetchone()
        if not row:
            raise KeyError('Video not found')
        pid, video = row['project_id'], json.loads(row['data'])
        jobs = [json.loads(r['data']) for r in c.execute('SELECT data FROM jobs WHERE project_id=?', (pid,))]
        if video.get('status') == 'indexing' or any(j.get('status') in ('queued', 'running') for j in jobs):
            raise HTTPException(409, 'Wait for video processing or exports to finish, then delete the video.')
        project = db.get_state(c, pid)
        state = project['state']
        removed_people = set()
        for collection in ('observations', 'segments', 'intervals', 'reviews', 'proposal_reviews'):
            for key, value in list(state[collection].items()):
                if value['video_id'] != vid:
                    continue
                if value.get('identity_uuid'):
                    removed_people.add(value['identity_uuid'])
                del state[collection][key]
                c.execute('DELETE FROM entities WHERE project_id=? AND collection=? AND id=?', (pid, collection, key))
        remaining_people = {v['identity_uuid'] for collection in ('observations', 'segments', 'intervals') for v in state[collection].values()}
        removed_people -= remaining_people
        for identity in removed_people:
            c.execute("DELETE FROM entities WHERE project_id=? AND collection='identities' AND id=?", (pid, identity))
        for key, link in state['links'].items():
            if link['source'] in removed_people or link['target'] in removed_people:
                c.execute("DELETE FROM entities WHERE project_id=? AND collection='links' AND id=?", (pid, key))
        # Operations involving this video cannot be replayed after permanent deletion.
        for row in c.execute('SELECT id,data FROM operations WHERE project_id=?', (pid,)).fetchall():
            op = json.loads(row['data'])
            touches = op.get('video_id') == vid or any(
                value and (value.get('video_id') == vid or (change['collection'] == 'identities' and change['id'] in removed_people))
                for change in op['changes'] for value in (change.get('before'), change.get('after')))
            if touches:
                c.execute('DELETE FROM operations WHERE id=?', (row['id'],))
        for table in ('frames', 'proposals', 'proposal_frames'):
            c.execute(f'DELETE FROM {table} WHERE video_id=?', (vid,))
        c.execute('DELETE FROM videos WHERE id=?', (vid,))
        remaining = c.execute('SELECT 1 FROM videos WHERE project_id=?', (pid,)).fetchone() is not None
        removed_exports = set()
        for row in c.execute('SELECT id,data FROM exports WHERE project_id=?', (pid,)).fetchall():
            export = json.loads(row['data']); settings = export.get('settings', {})
            if not remaining or settings.get('video_id') in (None, vid) or settings.get('format') != 'annotations_json':
                files.append((Path(export['path']), DATA / 'exports'))
                removed_exports.add(row['id'])
                c.execute('DELETE FROM exports WHERE id=?', (row['id'],))
        for job in jobs:
            if not remaining or job.get('video_id') == vid or job.get('settings', {}).get('video_id') == vid or job.get('export_id') in removed_exports:
                if job.get('kind')=='review' and job.get('snapshot_path'):
                    files.append((Path(job['snapshot_path']).parent,DATA/'reviews'))
                c.execute('DELETE FROM jobs WHERE id=?', (job['id'],))
        for validation in c.execute('SELECT data FROM validations WHERE video_id=?', (vid,)).fetchall():
            report = json.loads(validation['data'])
            if report.get('mode') == 'structural' and report.get('snapshot_path'):
                files.append((Path(report['snapshot_path']).parent, DATA / 'validations'))
        c.execute('DELETE FROM validations WHERE video_id=?',(vid,))
        c.execute('UPDATE projects SET revision=revision+1 WHERE id=?', (pid,))
        if video.get('source'):
            files.append((Path(video['source']), DATA / 'originals'))
    warnings = []
    for path, allowed in [(DATA / 'frames' / vid, DATA / 'frames'), *files]:
        # Imported app-owned copies only; never follow a path to the external source.
        if not path.resolve().is_relative_to(allowed.resolve()) or path.resolve() == allowed.resolve():
            continue
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
        except OSError:
            warnings.append('Some cached files could not be removed. Close other programs using them before cleaning the app cache.')
    return {'deleted': True, 'video_id': vid, 'project_id': pid, 'project_deleted': False,
            'cleanup_warning': warnings[0] if warnings else None}
