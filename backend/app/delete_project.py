"""Permanently remove one workspace without deleting the user's source recordings."""
import json
import shutil
from pathlib import Path

from fastapi import HTTPException

from . import db
from .config import DATA


def project_jobs(connection, pid):
    jobs = [{**json.loads(row['data']), 'id': row['id'], 'project_id': row['project_id']} for row in connection.execute('SELECT id,project_id,data FROM jobs')]
    return [job for job in jobs if job.get('project_id') == pid or job.get('target_project_id') == pid or job.get('restored_project_id') == pid]


def require_idle(project, jobs):
    if any(video.get('status') == 'indexing' for video in project['videos'].values()) or any(job.get('status') in ('queued', 'running') for job in jobs):
        raise HTTPException(409, 'Wait for video processing, imports, or exports to finish, then try again.')


def delete_project(pid, base_revision):
    files = []
    with db.transaction() as connection:
        project = db.get_state(connection, pid)
        if project['revision'] != base_revision:
            raise db.Conflict(project['revision'])
        jobs = project_jobs(connection, pid)
        require_idle(project, jobs)

        # An imported archive can reference a managed copy used by another
        # project. Never unlink such a file while another video still needs it.
        shared_sources = {Path(video['source']).resolve() for row in connection.execute('SELECT data FROM videos WHERE project_id != ?', (pid,))
                          if (video := json.loads(row['data'])).get('source')}
        for vid, video in project['videos'].items():
            files.append((DATA / 'frames' / vid, DATA / 'frames'))
            if video.get('source') and Path(video['source']).resolve() not in shared_sources:
                files.append((Path(video['source']), DATA / 'originals'))
            for table in ('frames', 'proposals', 'proposal_frames'):
                connection.execute(f'DELETE FROM {table} WHERE video_id=?', (vid,))
        for row in connection.execute('SELECT data FROM exports WHERE project_id=?', (pid,)):
            export = json.loads(row['data'])
            if export.get('path'):
                files.append((Path(export['path']), DATA / 'exports'))
        for job in jobs:
            if job.get('kind') == 'review' and job.get('snapshot_path'):
                files.append((Path(job['snapshot_path']).parent, DATA / 'reviews'))
            connection.execute('DELETE FROM jobs WHERE id=?', (job['id'],))
        for row in connection.execute('SELECT data FROM validations WHERE project_id=?', (pid,)):
            validation = json.loads(row['data'])
            if validation.get('snapshot_path'):
                files.append((Path(validation['snapshot_path']).parent, DATA / 'validations'))
        for table in ('camera_session_events', 'camera_session_detached_assignments'):
            connection.execute(f'DELETE FROM {table} WHERE session_id IN (SELECT id FROM camera_sessions WHERE project_id=?)', (pid,))
        for table in ('camera_sessions', 'project_settings_events', 'validations', 'exports', 'operations', 'entities', 'videos'):
            connection.execute(f'DELETE FROM {table} WHERE project_id=?', (pid,))
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='restored_history'").fetchone():
            connection.execute('DELETE FROM restored_history WHERE project_id=?', (pid,))
        connection.execute('DELETE FROM projects WHERE id=?', (pid,))

    warning = None
    for path, allowed in files:
        # Resolve every candidate; never follow a symlink outside this cache or
        # delete the cache root itself. User-created backups are not candidates.
        try:
            resolved, root = path.resolve(), allowed.resolve()
            if resolved == root or not resolved.is_relative_to(root):
                continue
            if path.is_symlink():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
        except OSError:
            warning = 'The project was deleted, but some cached files are still in use and could not be removed.'
    return {'deleted': True, 'project_id': pid, 'cleanup_warning': warning}
