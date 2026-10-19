"""Explicit camera sessions and shared identities, separate from video annotations.

A local identity UUID still owns its boxes. An assignment is only a reviewed
association with a session person; it never copies or merges local annotations.
"""
import json
import uuid
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import db
from .schema import identity_video_scopes

router = APIRouter()


def uid():
    return str(uuid.uuid4())


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Camera(Strict):
    id: str = Field(default_factory=uid, min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    video_id: str = Field(min_length=1, max_length=200)
    # session time = elapsed source timestamp + offset_seconds.
    offset_seconds: float = Field(default=0, ge=-315576000, le=315576000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError('Enter a camera name without control characters')
        return value


class SharedPerson(Strict):
    id: str = Field(default_factory=uid, min_length=1, max_length=200)
    person_id: int = Field(gt=0, strict=True)
    name: str = Field(default='', max_length=150)
    color: str = Field(default='#22d3ee', pattern=r'^#[0-9a-fA-F]{6}$')

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if any(ord(char) < 32 for char in value):
            raise ValueError('Person names cannot contain control characters')
        return value


class Assignment(Strict):
    video_id: str = Field(min_length=1, max_length=200)
    identity_uuid: str = Field(min_length=1, max_length=200)
    person_uuid: str = Field(min_length=1, max_length=200)


class SessionFields(Strict):
    name: str = Field(min_length=1, max_length=150)
    cameras: list[Camera] = Field(max_length=64)
    people: list[SharedPerson] = Field(default_factory=list, max_length=10000)
    assignments: list[Assignment] = Field(default_factory=list, max_length=100000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError('Enter a session name without control characters')
        return value


class SessionCreate(SessionFields):
    pass


class SessionUpdate(SessionFields):
    revision: int = Field(ge=0, strict=True)
    # PATCH is a full writable snapshot. Omitted collections must never silently
    # erase existing people or reviewed assignments.
    people: list[SharedPerson] = Field(max_length=10000)
    assignments: list[Assignment] = Field(max_length=100000)


class CameraSession(SessionFields):
    id: str = Field(min_length=1, max_length=200)
    project_id: str = Field(min_length=1, max_length=200)
    mode: Literal['multicamera'] = 'multicamera'
    revision: int = Field(ge=0, strict=True)
    created_at: str
    updated_at: str


def validate_session_snapshot(snapshot, project, *, minimum_cameras=0):
    """Validate an exported/restored snapshot against its local project state.

    Checks structural references only. Overlapping views and tracks are valid;
    whether two tracks depict the same person remains a human decision.
    """
    value = CameraSession.model_validate(snapshot).model_dump(mode='json')
    if value['project_id'] != project['id']:
        raise ValueError('Camera session belongs to a different project')
    if len(value['cameras']) < minimum_cameras:
        raise ValueError(f'Select at least {minimum_cameras} different camera videos')
    camera_ids, video_ids, names = set(), set(), set()
    for camera in value['cameras']:
        if camera['id'] in camera_ids:
            raise ValueError('Each camera needs a unique ID')
        if camera['video_id'] in video_ids:
            raise ValueError('A video can appear only once in a camera session')
        if camera['name'].casefold() in names:
            raise ValueError('Each camera needs a different name')
        if camera['video_id'] not in project['videos']:
            raise ValueError('Every camera video must belong to this project')
        camera_ids.add(camera['id'])
        video_ids.add(camera['video_id'])
        names.add(camera['name'].casefold())
    people, numbers = set(), set()
    for person in value['people']:
        if person['id'] in people or person['person_id'] in numbers:
            raise ValueError('Each shared person needs a unique UUID and positive numeric ID')
        people.add(person['id'])
        numbers.add(person['person_id'])
    scopes = identity_video_scopes(project['state'])
    assigned = set()
    for assignment in value['assignments']:
        local_key = (assignment['video_id'], assignment['identity_uuid'])
        if local_key in assigned:
            raise ValueError('A local track can be assigned to only one shared person')
        if assignment['video_id'] not in video_ids:
            raise ValueError('Assigned tracks must belong to a camera in this session')
        if assignment['person_uuid'] not in people:
            raise ValueError('Assigned shared person does not exist')
        if assignment['identity_uuid'] not in project['state']['identities']:
            raise ValueError('Assigned local track does not exist')
        if assignment['video_id'] not in scopes.get(assignment['identity_uuid'], set()):
            raise ValueError('Assigned local track does not belong to that camera video')
        assigned.add(local_key)
    return value


def get_session(session_id, connection=None):
    if connection is None:
        with db.connect() as connection:
            return get_session(session_id, connection)
    row = connection.execute('SELECT data FROM camera_sessions WHERE id=?', (session_id,)).fetchone()
    if not row:
        raise KeyError('Camera session not found')
    return json.loads(row['data'])


def list_sessions(project_id, connection=None):
    if connection is None:
        with db.connect() as connection:
            return list_sessions(project_id, connection)
    if not connection.execute('SELECT 1 FROM projects WHERE id=?', (project_id,)).fetchone():
        raise KeyError('Project not found')
    return [json.loads(row['data']) for row in connection.execute(
        'SELECT data FROM camera_sessions WHERE project_id=? ORDER BY rowid DESC', (project_id,))]


def _event(connection, previous, current, reason):
    connection.execute('INSERT INTO camera_session_events VALUES(?,?,?,?,?)', (
        uid(), current['id'], current['revision'],
        json.dumps({'reason': reason, 'before': previous, 'after': current}, allow_nan=False), db.now()))


def insert_session(connection, project_id, body):
    """Insert in the caller's transaction; useful for atomic session imports."""
    body = SessionCreate.model_validate(body)
    project = db.get_state(connection, project_id)
    timestamp = db.now()
    value = validate_session_snapshot({
        **body.model_dump(mode='json'), 'id': uid(), 'project_id': project_id,
        'mode': 'multicamera', 'revision': 0, 'created_at': timestamp, 'updated_at': timestamp,
    }, project, minimum_cameras=2)
    connection.execute('INSERT INTO camera_sessions VALUES(?,?,?,?)', (
        value['id'], project_id, value['revision'], json.dumps(value, allow_nan=False)))
    _event(connection, None, value, 'create')
    return value


def create_session(project_id, body):
    with db.transaction() as connection:
        return insert_session(connection, project_id, body)


def _replace_session(connection, previous, value, reason):
    value = {**value, 'revision': previous['revision'] + 1, 'updated_at': db.now()}
    connection.execute('UPDATE camera_sessions SET revision=?,data=? WHERE id=?', (
        value['revision'], json.dumps(value, allow_nan=False), value['id']))
    _event(connection, previous, value, reason)
    return value


def update_session(session_id, body):
    body = SessionUpdate.model_validate(body)
    with db.transaction() as connection:
        previous = get_session(session_id, connection)
        if body.revision != previous['revision']:
            raise db.Conflict(previous['revision'])
        project = db.get_state(connection, previous['project_id'])
        # Removing a video can leave one or zero cameras. Such a session stays
        # editable, so the user can add replacement recordings without data loss.
        value = validate_session_snapshot({**previous, **body.model_dump(mode='json')}, project,
                                          minimum_cameras=min(2, len(previous['cameras'])))
        people = {p['id'] for p in value['people']}
        videos = {camera['video_id'] for camera in value['cameras']}
        assigned = {(a['video_id'], a['identity_uuid']) for a in value['assignments']}
        for detached in connection.execute('SELECT * FROM camera_session_detached_assignments WHERE session_id=?', (session_id,)).fetchall():
            if detached['person_uuid'] not in people or detached['video_id'] not in videos or (detached['video_id'], detached['identity_uuid']) in assigned:
                connection.execute('DELETE FROM camera_session_detached_assignments WHERE session_id=? AND video_id=? AND identity_uuid=?',
                                   (session_id, detached['video_id'], detached['identity_uuid']))
        if value == previous:
            return previous
        return _replace_session(connection, previous, value, 'edit')


def prune_assignments(connection, project_id, state):
    """Detach removed tracks and revive their mapping when annotation undo restores them."""
    sessions = list_sessions(project_id, connection)
    if not sessions:
        return
    scopes = identity_video_scopes(state)
    for previous in sessions:
        assignments = [a for a in previous['assignments']
                       if a['identity_uuid'] in state['identities']
                       and a['video_id'] in scopes.get(a['identity_uuid'], set())]
        retained = {(a['video_id'], a['identity_uuid']) for a in assignments}
        for assignment in previous['assignments']:
            if (assignment['video_id'], assignment['identity_uuid']) not in retained:
                connection.execute('INSERT OR REPLACE INTO camera_session_detached_assignments VALUES(?,?,?,?)',
                                   (previous['id'], assignment['video_id'], assignment['identity_uuid'], assignment['person_uuid']))
        videos = {camera['video_id'] for camera in previous['cameras']}
        people = {person['id'] for person in previous['people']}
        for detached in connection.execute('SELECT * FROM camera_session_detached_assignments WHERE session_id=?', (previous['id'],)).fetchall():
            if detached['video_id'] in videos and detached['person_uuid'] in people and detached['identity_uuid'] in state['identities'] and detached['video_id'] in scopes.get(detached['identity_uuid'], set()):
                key = (detached['video_id'], detached['identity_uuid'])
                if key not in retained:
                    assignments.append({key: detached[key] for key in ('video_id', 'identity_uuid', 'person_uuid')})
                    retained.add(key)
                connection.execute('DELETE FROM camera_session_detached_assignments WHERE session_id=? AND video_id=? AND identity_uuid=?',
                                   (previous['id'], detached['video_id'], detached['identity_uuid']))
        if assignments != previous['assignments']:
            _replace_session(connection, previous, {**previous, 'assignments': assignments}, 'local-track-membership-changed')


def remove_video_memberships(connection, project_id, video_id):
    """Called in video deletion's transaction; never remove other camera links."""
    for previous in list_sessions(project_id, connection):
        connection.execute('DELETE FROM camera_session_detached_assignments WHERE session_id=? AND video_id=?', (previous['id'], video_id))
        cameras = [camera for camera in previous['cameras'] if camera['video_id'] != video_id]
        if cameras == previous['cameras']:
            continue
        assignments = [a for a in previous['assignments'] if a['video_id'] != video_id]
        _replace_session(connection, previous, {**previous, 'cameras': cameras, 'assignments': assignments}, 'video-removed')


@router.get('/api/projects/{project_id}/camera-sessions')
def camera_sessions(project_id: str):
    return list_sessions(project_id)


@router.post('/api/projects/{project_id}/camera-sessions', status_code=201)
def new_camera_session(project_id: str, body: SessionCreate):
    return create_session(project_id, body)


@router.get('/api/camera-sessions/{session_id}')
def camera_session(session_id: str):
    return get_session(session_id)


@router.patch('/api/camera-sessions/{session_id}')
def save_camera_session(session_id: str, body: SessionUpdate):
    return update_session(session_id, body)
