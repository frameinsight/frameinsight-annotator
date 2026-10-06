"""Read selected JSON fields without materializing legacy editing history."""
import gzip
import io

import ijson
from ijson.common import ObjectBuilder

JSON_UPLOAD_LIMIT = 1024 * 1024 * 1024
JSON_STATE_LIMIT = 128 * 1024 * 1024


class LimitedReader:
    def __init__(self, source, limit=JSON_UPLOAD_LIMIT):
        self.source, self.limit, self.count = source, limit, 0

    def read(self, size=-1):
        if size == 0:
            return b''
        data = self.source.read(min(size if size >= 0 else 65536, self.limit - self.count + 1))
        self.count += len(data)
        if self.count > self.limit:
            raise ValueError('Annotation JSON exceeds the 1 GiB limit (after decompression)')
        return data


class UniqueKeys(dict):
    def __setitem__(self, key, value):
        if key in self:
            raise ValueError('Duplicate keys in annotation JSON')
        super().__setitem__(key, value)


def read_annotation_json(source):
    """Validate the whole file, retaining only fields required for editable import.

    Uploaded files are already spooled to disk by the HTTP layer. Parsing events
    also skips redundant indexes, old validation proofs and before/after records.
    Both compressed input and decoded bytes are bounded; no ZIP extraction.
    """
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    source.seek(0, 2)
    if source.tell() > JSON_UPLOAD_LIMIT:
        raise ValueError('Annotation JSON upload limit is 1 GiB')
    source.seek(0)
    magic = source.read(3)
    source.seek(0)
    compressed = magic[:2] == b'\x1f\x8b'
    decoded = gzip.GzipFile(fileobj=source) if compressed else source
    try:
        # json.loads accepted a UTF-8 BOM in earlier exports; preserve that support.
        if compressed:
            if decoded.peek(3)[:3] == b'\xef\xbb\xbf':
                decoded.read(3)
        elif magic == b'\xef\xbb\xbf':
            source.read(3)
        reader = LimitedReader(decoded)
        fields = {'format', 'schema_version', 'videos', 'state'}
        result, keys = {}, set()
        depth, retained, builder, field = 0, 0, None, None
        for event, value in ijson.basic_parse(reader, use_float=True):
            if depth == 0 and event != 'start_map':
                raise ValueError('Annotation JSON must contain one object')
            if depth == 1 and event == 'map_key':
                if value in keys:
                    raise ValueError('Duplicate keys in annotation JSON')
                keys.add(value)
                field = value
                builder = ObjectBuilder(map_type=UniqueKeys) if field in fields else None
                continue
            if builder is not None:
                retained += len(value.encode('utf-8')) if isinstance(value, str) else 16
                if retained > JSON_STATE_LIMIT:
                    raise ValueError('Current annotation state exceeds 128 MiB; import a smaller video export')
                builder.event(event, value)
            if event in ('start_map', 'start_array'):
                depth += 1
                if depth > 64:
                    raise ValueError('Annotation JSON is nested too deeply')
            elif event in ('end_map', 'end_array'):
                depth -= 1
            if builder is not None and depth == 1:
                result[field] = builder.value
                builder = None
        if depth != 0:
            raise ValueError('Incomplete annotation JSON')
        return result
    except (ijson.JSONError, UnicodeError, EOFError, OSError, OverflowError) as error:
        raise ValueError('Choose a complete, valid Frameinsight JSON or JSON.gz file') from error
    finally:
        if compressed:
            decoded.close()
