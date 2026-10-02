"""Portable attachment names; user input never becomes a filesystem path."""
import re


def json_filename(name):
    stem = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', '_', name or '').strip(' .')
    stem = re.sub(r'\.json$', '', stem, flags=re.IGNORECASE).strip(' .')
    stem = stem[:160].rstrip(' .') or 'annotations'
    if re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', stem, re.IGNORECASE):
        stem = '_' + stem
    return stem + '.json'
