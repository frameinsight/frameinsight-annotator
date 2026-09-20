"""Optional GPU assistance API. Importing the manual app never requires Torch."""
import importlib.util
import json
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from . import db
from .config import MODELS
from .tracking import DEFAULT_MODEL, OFFICIAL_MODELS, TRACKERS, request_key, track_summary

router = APIRouter()


class AssistSettings(BaseModel):
    model: str = DEFAULT_MODEL
    tracker: Literal['botsort', 'tracktrack'] = 'botsort'
    device: Literal['auto', 'cpu', '0'] = 'auto'
    imgsz: int = Field(default=960, ge=320, le=1536, multiple_of=32)
    confidence: float = Field(default=.1, ge=.01, le=.25)
    reid: bool = True


@lru_cache(maxsize=1)
def runtime_status():
    if not importlib.util.find_spec('torch') or not importlib.util.find_spec('ultralytics'):
        return {'available': False, 'gpu': None, 'error': 'AI dependencies are not installed. Manual annotation and imported suggestions remain available.'}
    try:
        import torch
        from ultralytics.trackers.track import TRACKER_MAP
        return {'available': True, 'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                'trackers': [name for name in TRACKERS if name in TRACKER_MAP]}
    except Exception as e:
        return {'available': False, 'gpu': None, 'error': f'AI runtime could not load: {e}'}


@router.get('/api/assist/status')
def status():
    return {'trackers': [], **runtime_status(), 'default_model': DEFAULT_MODEL,
            'models': [{'name': name, 'label': label, 'installed': (MODELS / name).is_file(),
                        'bytes': (MODELS / name).stat().st_size if (MODELS / name).is_file() else 0}
                       for name, label in OFFICIAL_MODELS.items()]}


def video_get(vid):
    with db.connect() as c:
        row = c.execute('SELECT project_id,data FROM videos WHERE id=?', (vid,)).fetchone()
    if not row: raise KeyError('Video not found')
    return {**json.loads(row['data']), 'project_id': row['project_id']}


def jobs_for(vid):
    with db.connect() as c:
        return [j for row in c.execute('SELECT data FROM jobs ORDER BY rowid DESC')
                if (j := json.loads(row['data'])).get('video_id') == vid and j.get('settings', {}).get('mode') == 'tracking']


@router.post('/api/videos/{vid}/assist')
def start(vid: str, body: AssistSettings, request: Request):
    video = video_get(vid)
    if video.get('status') != 'ready': raise ValueError('Wait for the video to finish loading')
    if body.model not in OFFICIAL_MODELS: raise ValueError('Choose a model listed in Detect & track')
    runtime = runtime_status()
    if not runtime['available']: raise ValueError(runtime['error'])
    if body.tracker not in runtime.get('trackers', []): raise ValueError('Update the AI dependencies to use this tracker')
    settings = body.model_dump()
    settings['device'] = ('0' if runtime['gpu'] else 'cpu') if body.device == 'auto' else body.device
    if settings['device'] != 'cpu' and not runtime['gpu']: raise ValueError('CUDA is not available; choose CPU')
    settings['mode'] = 'tracking'
    key = request_key(video, settings)
    for job in jobs_for(vid):
        if job.get('settings') != settings: continue
        if job['status'] in ('queued', 'running'): return {**job, 'reused': True}
        if job.get('request_key') == key and job['status'] == 'completed':
            with db.connect() as c:
                count = c.execute('SELECT COUNT(*) FROM proposal_frames WHERE video_id=? AND cache_key=?', (vid, job.get('cache_key'))).fetchone()[0]
            if count == video['frame_count']: return {**job, 'reused': True}
    worker = request.app.state.assistance_worker
    job = worker.enqueue(video['project_id'], vid, settings)
    return db.job_update(job['id'], request_key=key)


def cached_proposals(vid, key=None):
    video = video_get(vid)
    jobs = jobs_for(vid)
    if key is None:
        latest = next((j for j in jobs if j.get('cache_key')), None)
        key = latest['cache_key'] if latest else None
    else: latest = next((j for j in jobs if j.get('cache_key') == key), None)
    with db.connect() as c:
        rows = c.execute('SELECT data FROM proposals WHERE video_id=? AND cache_key=? ORDER BY frame_index', (vid, key)).fetchall() if key else []
        count = c.execute('SELECT COUNT(*) FROM proposal_frames WHERE video_id=? AND cache_key=?', (vid, key)).fetchone()[0] if key else 0
    return video, key, [json.loads(row['data']) for row in rows], {
        'status': latest['status'] if latest else 'not_started', 'processed_frames': count,
        'total_frames': video['frame_count'], 'complete': count == video['frame_count'] and count > 0}


@router.get('/api/videos/{vid}/tracks')
def tracks(vid: str, cache_key: str | None = None):
    video, key, proposals, progress = cached_proposals(vid, cache_key)
    return {'cache_key': key, 'tracks': track_summary(proposals, video['frame_count']), **progress}


@router.get('/api/videos/{vid}/tracks/{track_id}')
def track(vid: str, track_id: str, cache_key: str | None = None):
    video, key, proposals, progress = cached_proposals(vid, cache_key)
    proposals = [p for p in proposals if p.get('track_id') == track_id]
    if not proposals: raise KeyError('Track not found in this video/cache')
    summary = track_summary(proposals, video['frame_count'])[0]
    return {'track_id': track_id, 'cache_key': key, 'proposals': proposals, 'issues': summary['issues'], **progress}
