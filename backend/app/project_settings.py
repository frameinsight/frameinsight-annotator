"""Atomic metadata edits, including the class channels used by saved recovery history."""
import copy
import json
import uuid
from collections import defaultdict

from pydantic import Field, field_validator

from . import db
from .geometry import LEGACY_KEYS, box_items, box_style
from .schema import MODELS, Strict, validate_state


def clean_name(value, *, limit, label):
    value = value.strip()
    if not value or len(value) > limit or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(f'{label} must contain 1–{limit} characters without control characters')
    return value


class ProjectSettings(Strict):
    base_revision: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=150)
    class_renames: dict[str, str] = Field(default_factory=dict, max_length=100)
    new_classes: list[str] = Field(default_factory=list, max_length=100)
    request_id: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator('name')
    @classmethod
    def project_name(cls, value):
        return clean_name(value, limit=150, label='Project name')

    @field_validator('class_renames')
    @classmethod
    def renamed_classes(cls, values):
        cleaned = {}
        for old, new in values.items():
            old = clean_name(old, limit=80, label='Class name')
            if old in cleaned:
                raise ValueError('A class can only be renamed once')
            cleaned[old] = clean_name(new, limit=80, label='Class name')
        return cleaned

    @field_validator('new_classes')
    @classmethod
    def added_classes(cls, values):
        values = [clean_name(name, limit=80, label='Class name') for name in values]
        if len(set(values)) != len(values):
            raise ValueError('Each class needs a different name')
        return values


def renamed_key(key, names):
    return 'class:' + names.get(key[6:], key[6:]) if key.startswith('class:') else key


def _remap_keys(values, names):
    result = {}
    for old, value in values.items():
        new = renamed_key(old, names)
        if new in result:
            raise ValueError('Renaming would combine two class channels')
        result[new] = value
    return result


def _legacy_style(identity, key):
    # Old extended-only identities encoded their class/color on the identity.
    # Materialize that appearance before its name stops being a legacy alias.
    if key == 'person_ext' and not identity.get('box_styles') and identity.get('class_name', '').lower() in ('person_extended', 'person_ext', 'person_exteded'):
        return {'class_name': identity['class_name'], 'color': identity.get('color', '#67e2b1')}
    return box_style(identity, key)


def rename_entity(collection, value, names, used_keys):
    if value is None:
        return None
    result = copy.deepcopy(value)
    if collection == 'identities':
        styles = result.get('box_styles', {})
        # Fixed legacy geometry slots retain their meaning and coordinates.
        # Implicit labels must become explicit so default names cannot reappear.
        for key in used_keys.get(result['id'], set()) & set(LEGACY_KEYS):
            style = _legacy_style(value, key)
            if key not in styles and style['class_name'] in names:
                styles[key] = style
        if styles or 'box_styles' in result:
            result['box_styles'] = _remap_keys({key: {**style, 'class_name': names.get(style['class_name'], style['class_name'])} for key, style in styles.items()}, names)
        if 'class_name' in result:
            result['class_name'] = names.get(result['class_name'], result['class_name'])
    elif collection == 'observations':
        for field in ('boxes', 'provenance'):
            if field in result:
                result[field] = _remap_keys(result[field], names)
    elif collection == 'intervals' and result.get('geometry'):
        result['geometry'] = renamed_key(result['geometry'], names)
    return result


def _history_operations(history):
    if not isinstance(history, dict):
        return
    yield from history.get('operations', [])
    yield from _history_operations(history.get('previous_restored_history'))


def _history_entities(operations):
    for operation in operations:
        for change in operation.get('changes', []):
            for side in ('before', 'after'):
                if change.get(side):
                    yield change['collection'], change[side]


def _rename_operation(operation, names, used_keys):
    return {**operation, 'changes': [{**change, **{side: rename_entity(change['collection'], change.get(side), names, used_keys) for side in ('before', 'after')}} for change in operation.get('changes', [])]}


def _rename_restored(history, names, used_keys):
    if not isinstance(history, dict):
        return history
    result = {**history, 'operations': [_rename_operation(op, names, used_keys) for op in history.get('operations', [])]}
    if 'previous_restored_history' in history:
        result['previous_restored_history'] = _rename_restored(history['previous_restored_history'], names, used_keys)
    return result


def update_settings(pid, settings: ProjectSettings):
    request = settings.model_dump(mode='json')
    request_json = json.dumps(request, sort_keys=True)
    with db.transaction() as connection:
        project = db.get_state(connection, pid)
        if settings.request_id:
            old = connection.execute('SELECT project_id,request FROM project_settings_events WHERE id=?', (settings.request_id,)).fetchone()
            if old:
                if old['project_id'] != pid or old['request'] != request_json:
                    raise ValueError('Settings request ID was reused with different content')
                return project
        if project['revision'] != settings.base_revision:
            raise db.Conflict(project['revision'])

        operations = [(row['id'], json.loads(row['data'])) for row in connection.execute('SELECT id,data FROM operations WHERE project_id=? ORDER BY revision', (pid,))]
        restored_table = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='restored_history'").fetchone()
        restored_row = connection.execute('SELECT data FROM restored_history WHERE project_id=?', (pid,)).fetchone() if restored_table else None
        restored = json.loads(restored_row['data']) if restored_row else None
        entities = [(collection, value) for collection, values in project['state'].items() for value in values.values()]
        entities.extend(_history_entities([op for _, op in operations]))
        entities.extend(_history_entities(_history_operations(restored)))
        used_keys = defaultdict(set)
        for collection, value in entities:
            if collection == 'observations':
                used_keys[value['identity_uuid']].update(key for key, _ in box_items(value))
            elif collection == 'intervals' and value.get('geometry'):
                used_keys[value['identity_uuid']].add(value['geometry'])
            elif collection == 'identities':
                used_keys[value['id']].update(value.get('box_styles', {}))

        # Include imported/legacy classes and deleted classes in the collision
        # check: undo and deleted-range recovery must not merge their channels.
        known = list(dict.fromkeys(project['classes']))
        for collection, value in entities:
            names = []
            if collection == 'identities':
                if value.get('class_name'):
                    names.append(value['class_name'])
                names.extend(style['class_name'] for style in value.get('box_styles', {}).values())
                names.extend(_legacy_style(value, key)['class_name'] for key in used_keys[value['id']] & set(LEGACY_KEYS))
            elif collection == 'observations':
                names.extend(key[6:] for key, _ in box_items(value) if key.startswith('class:'))
            elif collection == 'intervals' and (value.get('geometry') or '').startswith('class:'):
                names.append(value['geometry'][6:])
            for name in names:
                if name not in known:
                    known.append(name)
        renames = {old: new for old, new in settings.class_renames.items() if old != new}
        if any(old not in known for old in settings.class_renames):
            raise ValueError('A class to rename no longer exists; reload project settings')
        renamed_names = [renames.get(name, name) for name in known]
        if len(set(renamed_names)) != len(renamed_names) or set(renamed_names) & set(settings.new_classes):
            raise ValueError('Each class needs a different name; renaming cannot merge classes')
        if len(renamed_names) + len(settings.new_classes) > 100:
            raise ValueError('A project supports at most 100 classes')

        # No-op requests do not invalidate a finished video.
        if not renames and not settings.new_classes and settings.name == project['name']:
            return project
        state = {collection: {key: rename_entity(collection, value, renames, used_keys) for key, value in values.items()} for collection, values in project['state'].items()}
        for collection, values in state.items():
            for value in values.values():
                MODELS[collection].model_validate(value)
        validate_state(state, project['videos'], visible_only=True)
        classes = list(dict.fromkeys([*(renames.get(name, name) for name in project['classes']), *(renames[name] for name in renames if name not in project['classes']), *settings.new_classes]))
        # Unused generated legacy palette entries are not class collisions.
        palette = {name: color for name, color in project['class_colors'].items() if name not in renames and name not in renames.values()}
        for old, new in renames.items():
            if old in project['class_colors']:
                palette[new] = project['class_colors'][old]
        for identity in state['identities'].values():
            for style in identity.get('box_styles', {}).values():
                palette.setdefault(style['class_name'], style['color'])
        # Seed additions with existing colors without recreating renamed aliases.
        generated = db.class_palette(classes, palette)
        palette.update({name: generated[name] for name in classes})
        revision = project['revision'] + 1
        connection.execute('UPDATE projects SET name=?,classes=?,class_colors=?,revision=? WHERE id=?', (settings.name, json.dumps(classes), json.dumps(palette), revision, pid))
        for collection, values in state.items():
            for ident, value in values.items():
                if value != project['state'][collection][ident]:
                    connection.execute('UPDATE entities SET data=? WHERE project_id=? AND collection=? AND id=?', (json.dumps(value), pid, collection, ident))
        if renames:
            for ident, operation in operations:
                changed = _rename_operation(operation, renames, used_keys)
                if changed != operation:
                    connection.execute('UPDATE operations SET data=? WHERE id=?', (json.dumps(changed), ident))
            if restored_row:
                connection.execute('UPDATE restored_history SET data=? WHERE project_id=?', (json.dumps(_rename_restored(restored, renames, used_keys)), pid))
            # Proposals are inactive suggestions, but their labels still belong
            # to the project if a historical proposal appears in JSON exports.
            for row in connection.execute('SELECT id,data FROM proposals WHERE video_id IN (SELECT id FROM videos WHERE project_id=?)', (pid,)).fetchall():
                value = json.loads(row['data'])
                if value.get('class_name') in renames:
                    value['class_name'] = renames[value['class_name']]
                if value.get('geometry'):
                    value['geometry'] = renamed_key(value['geometry'], renames)
                connection.execute('UPDATE proposals SET data=? WHERE id=?', (json.dumps(value), row['id']))
        for vid, video in project['videos'].items():
            for key in ('finished_revision', 'finished_at', 'validation_id', 'review_job_id', 'coverage', 'finish_confirmation'):
                video.pop(key, None)
            connection.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(video), vid))
        event = {'revision': revision, 'previous_revision': project['revision'], 'name_before': project['name'], 'name_after': settings.name, 'class_renames': renames, 'new_classes': settings.new_classes, 'created_at': db.now()}
        connection.execute('INSERT INTO project_settings_events VALUES(?,?,?,?,?,?)', (settings.request_id or str(uuid.uuid4()), pid, revision, request_json, json.dumps(event), event['created_at']))
        return db.get_state(connection, pid)
