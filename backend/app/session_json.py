"""Bounded camera-session reader; repeated delivery rows live in temporary files.

The editable state is retained, but frame ledgers and derived indexes are read
one row at a time. They are still validated against the state before importing.
"""
import gzip
import io
import json
from array import array
from collections.abc import Sequence
from tempfile import TemporaryFile

import ijson
from ijson.common import ObjectBuilder

from .json_stream import JSON_STATE_LIMIT, JSON_UPLOAD_LIMIT, LimitedReader

ROW_LIMIT = 1024 * 1024
ROOT_FIELDS = {'format', 'schema_version', 'session', 'annotations'}
ANNOTATION_FIELDS = {'format', 'schema_version', 'project', 'classes', 'class_colors',
                     'videos', 'state', 'frames', 'annotation_index', 'frame_annotations',
                     'presence_intervals', 'summary'}
ROW_FIELDS = {'annotation_index', 'frame_annotations', 'presence_intervals'}
ITEM = object()


class DiskRows(Sequence):
    """Read-only JSON rows with a small offset index and deterministic cleanup."""
    def __init__(self):
        self.file = TemporaryFile(mode='w+b')
        self.offsets = array('Q')

    def append(self, row):
        data = json.dumps(row, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        if len(data) > ROW_LIMIT:
            raise ValueError('A camera session JSON row exceeds the 1 MiB limit.')
        self.file.seek(0, 2)
        self.offsets.append(self.file.tell())
        self.file.write(data + b'\n')

    def __len__(self):
        return len(self.offsets)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[n] for n in range(*index.indices(len(self)))]
        self.file.seek(self.offsets[index])
        return json.loads(self.file.readline())

    def __iter__(self):
        for index in range(len(self)):
            yield self[index]

    def __eq__(self, other):
        if not isinstance(other, Sequence) or len(self) != len(other):
            return False
        return all(a == b for a, b in zip(self, other))

    def close(self):
        self.file.close()


class SessionDocument(dict):
    def __init__(self):
        super().__init__()
        self.rows = []

    def close(self):
        for rows in self.rows:
            rows.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def __del__(self):
        self.close()


def _keep(path):
    return (not path or path[0] in ROOT_FIELDS) and (
        len(path) < 2 or path[0] != 'annotations' or path[1] in ANNOTATION_FIELDS)


def _rows(path):
    return (len(path) == 2 and path[0] == 'annotations' and path[1] in ROW_FIELDS
            or len(path) == 3 and path[:2] == ('annotations', 'frames'))


def read_session_json(source):
    """Parse all JSON, including skipped history, without retaining derived arrays.

    Duplicate keys, malformed skipped values and decompression bombs are still
    rejected. The state budget applies to editable data, not repeated indexes.
    The returned context manager owns all temporary files.
    """
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    source.seek(0, 2)
    if source.tell() > JSON_UPLOAD_LIMIT:
        raise ValueError('Camera session JSON upload limit is 1 GiB')
    source.seek(0)
    magic = source.read(3)
    source.seek(0)
    compressed = magic[:2] == b'\x1f\x8b'
    decoded = gzip.GzipFile(fileobj=source) if compressed else source
    result = SessionDocument()
    try:
        if compressed:
            if decoded.peek(3)[:3] == b'\xef\xbb\xbf':
                decoded.read(3)
        elif magic == b'\xef\xbb\xbf':
            source.read(3)
        builder, stack, retained, ledger_count = ObjectBuilder(), [], 0, 0
        active, row_builder, row_size = None, None, 0
        for event, value in ijson.basic_parse(LimitedReader(decoded, JSON_UPLOAD_LIMIT), use_float=True):
            if not stack and event != 'start_map':
                raise ValueError('Camera session JSON must contain one object.')
            if event == 'map_key':
                parent = stack[-1]
                if value in parent['keys']:
                    raise ValueError('Duplicate keys in annotation JSON')
                parent['keys'].add(value)
                parent['key'] = value
                path = parent['path'] + (value,)
            elif event in ('end_map', 'end_array'):
                path = stack[-1]['path']
            else:
                parent = stack[-1] if stack else None
                path = parent['path'] + (parent['key'] if parent['kind'] == 'start_map' else ITEM,) if parent else ()
            depth = len(stack)
            if event in ('start_map', 'start_array'):
                stack.append({'path': path, 'kind': event, 'key': None, 'keys': set()})
                if len(stack) > 64:
                    raise ValueError('Camera session JSON is nested too deeply')
            elif event in ('end_map', 'end_array'):
                stack.pop()

            if active is not None:
                if event == 'end_array' and depth == active[1]:
                    active = None
                    continue
                if row_builder is None:
                    row_builder, row_size = ObjectBuilder(), 0
                row_size += len(value.encode('utf-8')) if isinstance(value, str) else 16
                if row_size > ROW_LIMIT:
                    raise ValueError('A camera session JSON row exceeds the 1 MiB limit.')
                row_builder.event(event, value)
                if len(stack) == active[1]:
                    active[0].append(row_builder.value)
                    row_builder = None
                continue
            if not _keep(path):
                continue
            if event == 'start_array' and _rows(path):
                if path[:2] == ('annotations', 'frames'):
                    ledger_count += 1
                    if ledger_count > 64:
                        raise ValueError('A camera session supports at most 64 frame ledgers.')
                rows = DiskRows()
                result.rows.append(rows)
                builder.event('number', rows)
                active = (rows, len(stack))
                continue
            retained += len(value.encode('utf-8')) if isinstance(value, str) else 16
            if retained > JSON_STATE_LIMIT:
                raise ValueError('Editable camera annotations exceed 128 MiB. Export fewer cameras in one session; indexes and editing history do not count toward this limit.')
            builder.event(event, value)
        document = builder.value
        if not isinstance(document, dict) or document.get('format') != 'frameinsight.multicam.annotations' or document.get('schema_version') != 1:
            raise ValueError('Choose a Frameinsight multi-camera annotation JSON version 1.')
        result.update(document)
        return result
    except (ijson.JSONError, UnicodeError, EOFError, OSError, OverflowError) as error:
        result.close()
        raise ValueError('Choose a complete, valid camera session JSON or JSON.gz file.') from error
    except BaseException:
        result.close()
        raise
    finally:
        if compressed:
            decoded.close()
