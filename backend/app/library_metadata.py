"""Read-only dates for library rows, derived from recorded video activity."""
import json
from collections import defaultdict
from datetime import datetime, timezone


def timestamp(value):
    """Unknown or timezone-less dates are not reliable activity timestamps."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None else None
    except ValueError:
        return None


def video_dates(connection, rows):
    videos = {row['id']: json.loads(row['data']) for row in rows}
    projects = {row['id']: row['project_id'] for row in rows}
    created, updated, indexing_started = defaultdict(list), defaultdict(list), defaultdict(list)

    def record(target, vid, value):
        parsed = timestamp(value)
        if vid in videos and parsed is not None:
            target[vid].append(parsed)

    for vid, video in videos.items():
        for field in ('created_at', 'imported_at'):
            record(created, vid, video.get(field))
        for field in ('created_at', 'imported_at', 'updated_at', 'indexed_at', 'finished_at'):
            record(updated, vid, video.get(field))

    # Index jobs are the existing import ledger. Exporting, opening a project,
    # reading frames or rendering a preview does not count as annotation work.
    for row in connection.execute("SELECT data FROM jobs WHERE json_extract(data,'$.kind')='index'"):
        job = json.loads(row['data']); vid = job.get('video_id')
        record(indexing_started, vid, job.get('created_at'))
        record(updated, vid, job.get('created_at'))
        record(updated, vid, job.get('updated_at'))

    settings_dates = {row['project_id']: row['created_at'] for row in connection.execute('''
        SELECT project_id,created_at,MAX(julianday(created_at)) AS latest
        FROM project_settings_events WHERE julianday(created_at) IS NOT NULL GROUP BY project_id
    ''')}
    for vid, pid in projects.items():
        record(updated, vid, settings_dates.get(pid))
    for row in connection.execute('SELECT video_id,data FROM validations'):
        report = json.loads(row['data'])
        if report.get('passed'):
            record(updated, row['video_id'], report.get('created_at'))

    identity_videos = defaultdict(set)
    for row in connection.execute('''
        SELECT DISTINCT project_id,json_extract(data,'$.identity_uuid') AS identity_id,
               json_extract(data,'$.video_id') AS video_id
        FROM entities WHERE collection IN ('segments','observations','intervals')
    '''):
        identity_videos[(row['project_id'], row['identity_id'])].add(row['video_id'])
    # Walk newest events first and stop once every video's latest activity is
    # known. Sorting IDs/dates instead of large JSON blobs keeps this cheap on
    # a long recording; an ordinary one-video project needs one edit payload.
    for pid in set(projects.values()):
        pending = {vid for vid, project_id in projects.items() if project_id == pid}
        for row in connection.execute('SELECT id,created_at FROM operations WHERE project_id=? ORDER BY julianday(created_at) DESC,created_at DESC', (pid,)):
            recorded = timestamp(row['created_at'])
            if recorded is None:
                continue
            pending = {vid for vid in pending if not updated[vid] or max(updated[vid]) < recorded}
            if not pending:
                break
            operation = json.loads(connection.execute('SELECT data FROM operations WHERE id=?', (row['id'],)).fetchone()['data'])
            changes = operation.get('changes', [])
            touched = {operation.get('video_id')} if changes else set()
            for change in changes:
                if change.get('collection') == 'identities':
                    touched.update(identity_videos[(pid, change.get('id'))])
                for side in ('before', 'after'):
                    value = change.get(side) or {}
                    touched.add(value.get('video_id'))
                    if change.get('collection') == 'links':
                        touched.update(identity_videos[(pid, value.get('source'))])
                        touched.update(identity_videos[(pid, value.get('target'))])
            for vid in pending & touched:
                record(updated, vid, row['created_at'])
            pending -= touched
            if not pending:
                break

    return {vid: {
        'created_at': min(created[vid] or indexing_started[vid]).isoformat() if created[vid] or indexing_started[vid] else None,
        'updated_at': max(updated[vid]).isoformat() if updated[vid] else None,
    } for vid in videos}
