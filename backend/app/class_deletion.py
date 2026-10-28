"""Remove class channels from live state and recoverable operation snapshots."""
import copy

from .geometry import LEGACY_KEYS, box_items, box_style


def legacy_style(identity, key):
    if key == 'person_ext' and not identity.get('box_styles') and identity.get('class_name', '').lower() in ('person_extended', 'person_ext', 'person_exteded'):
        return {'class_name': identity['class_name'], 'color': identity.get('color', '#67e2b1')}
    return box_style(identity, key)


class ClassDeletion:
    def __init__(self, project, entities, used_keys, deleted, removed_proposals=()):
        self.deleted = set(deleted)
        self.used_keys = used_keys
        self.removed_proposals = set(removed_proposals)
        self.identities = {value['id']: value for collection, value in entities if collection == 'identities'}
        self.identities.update(project['state']['identities'])
        self.removed = {ident for ident, value in self.identities.items() if self.identity(value) is None}

    def class_name(self, ident, key):
        if key.startswith('class:'):
            return key[6:]
        return legacy_style(self.identities.get(ident, {}), key)['class_name']

    def identity(self, value, *, historical=False):
        result = copy.deepcopy(value)
        styles = result.get('box_styles', {}).copy()
        keys = self.used_keys.get(value['id'], set())
        if historical:
            # Legacy class reassignment changes the meaning of the entire fixed
            # slot. Its old boxes still belong to the surviving current class.
            # Translate the old label rather than dropping a surviving box's
            # creation/undo record and leaving its identity references dangling.
            for key in set(LEGACY_KEYS) & keys:
                current = legacy_style(self.identities[value['id']], key)
                if legacy_style(value, key)['class_name'] in self.deleted and current['class_name'] not in self.deleted:
                    styles[key] = current
        names = {style['class_name'] for style in styles.values()} | {legacy_style(value, key)['class_name'] for key in keys} | {value.get('class_name', 'person_visible')}
        if not names & self.deleted:
            return result
        # Materialize surviving implicit styles before changing class_name;
        # otherwise the legacy visible slot would inherit a different class.
        for key in sorted(keys):
            styles.setdefault(key, legacy_style(value, key))
        styles = {key: style for key, style in styles.items() if style['class_name'] not in self.deleted and (not key.startswith('class:') or key[6:] not in self.deleted)}
        if not styles:
            if keys or value.get('box_styles') or value.get('class_name', 'person_visible') in self.deleted:
                return None
            return result
        result['box_styles'] = styles
        if result.get('class_name') not in {style['class_name'] for style in styles.values()}:
            result['class_name'] = next(iter(styles.values()))['class_name']
        return result

    def entity(self, collection, value, *, historical=False):
        if value is None:
            return None
        if collection == 'identities':
            if value['id'] in self.removed:
                return None
            # Preserve the surviving track when a historical snapshot predates
            # its surviving class, rather than turning an old edit into delete.
            return self.identity(value, historical=historical) or self.identity(self.identities[value['id']])
        ident = value.get('identity_uuid')
        if ident in self.removed or (collection == 'links' and {value['source'], value['target']} & self.removed):
            return None
        if collection == 'proposal_reviews' and value['proposal_id'] in self.removed_proposals:
            return None
        result = copy.deepcopy(value)

        def deleted_key(key):
            return self.class_name(ident, key) in self.deleted

        if collection == 'observations':
            for key in LEGACY_KEYS:
                if key in result and deleted_key(key):
                    result[key] = None
            for field in ('boxes', 'provenance'):
                if field in result:
                    result[field] = {key: item for key, item in result[field].items() if not deleted_key(key)}
            if any(box_items(value)) and not any(box_items(result)):
                return None
            if result.get('geometry_link') == 'equal' and result.get('person_ext') != result.get('person_visible'):
                result['geometry_link'] = 'independent'
        elif collection == 'intervals' and result.get('geometry') and deleted_key(result['geometry']):
            return None
        elif collection == 'reviews':
            result.update(complete=False, checked_all_people=False)
        return result

    def operation(self, operation):
        changes = []
        for change in operation.get('changes', []):
            value = {**change, **{side: self.entity(change['collection'], change.get(side), historical=True) for side in ('before', 'after')}}
            # Keep mixed operations and their IDs for exact compensation. An
            # operation that only changed a removed class becomes a safe no-op.
            if value['before'] != value['after']:
                changes.append(value)
        return {**operation, 'changes': changes}

    def restored(self, history):
        if not isinstance(history, dict):
            return history
        result = {**history, 'operations': [self.operation(op) for op in history.get('operations', [])]}
        if 'previous_restored_history' in history:
            result['previous_restored_history'] = self.restored(history['previous_restored_history'])
        return result
