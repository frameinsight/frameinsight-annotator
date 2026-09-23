"""Read legacy slots and named class channels without migrating saved records."""

LEGACY_KEYS = ('person_visible', 'person_ext')


def class_key(name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise ValueError('Class names must contain 1–80 characters')
    return 'class:' + name.strip()


def validate_key(key, *, dynamic_only=False):
    if not dynamic_only and key in LEGACY_KEYS:
        return key
    if not isinstance(key, str) or not key.startswith('class:') or class_key(key[6:]) != key:
        raise ValueError('Class geometry must use class:<trimmed class name>')
    return key


def get_box(observation, key):
    return observation.get(key) if key in LEGACY_KEYS else (observation.get('boxes') or {}).get(key)


def box_items(observation):
    for key in LEGACY_KEYS:
        if observation.get(key) is not None:
            yield key, observation[key]
    for key, box in (observation.get('boxes') or {}).items():
        if box is not None:
            yield key, box


def box_style(identity, key, colors=None):
    default_name = key[6:] if key.startswith('class:') else identity.get('class_name', 'person_visible') if key == 'person_visible' else 'person_extended'
    default_color = (identity.get('color', '#baa7ff') if key == 'person_visible' else '#67e2b1' if key == 'person_ext' else (colors or {}).get(default_name, identity.get('color', '#baa7ff')))
    return {'class_name': default_name, 'color': default_color, **identity.get('box_styles', {}).get(key, {})}


def reject_dynamic(observations):
    if any(o.get('boxes') for o in observations):
        raise ValueError('This legacy dataset format cannot represent named class channels. Use annotation JSON or a native project backup to preserve every class.')
