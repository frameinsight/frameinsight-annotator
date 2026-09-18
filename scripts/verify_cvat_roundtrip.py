"""Compare a local CVAT server's exported XML with Frameinsight's original XML."""
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT = Path(__file__).resolve().parents[1]

def boxes(root):
    result = {}
    for track in root.findall('track'):
        fixed = {}
        for b in track.findall('box'):
            attrs = {a.get('name'): a.text or '' for a in b.findall('attribute')}
            fixed.update({k: v for k, v in attrs.items() if k in ('person_id', 'identity_uuid')})
            attrs = {**fixed, **attrs}
            key = (track.get('label'), attrs['person_id'], int(b.get('frame')), b.get('outside', '0'))
            assert key not in result, key
            result[key] = ([float(b.get(k)) for k in ('xtl','ytl','xbr','ybr')], attrs, b.get('occluded'))
    return result

original = ET.parse(ROOT / '.frameinsight/review/cvat-acceptance.xml').getroot()
with zipfile.ZipFile(ROOT / '.frameinsight/review/cvat-server-roundtrip.zip') as z:
    assert z.testzip() is None
    returned = ET.fromstring(z.read('annotations.xml'))
a, b = boxes(original), boxes(returned)
assert a.keys() == b.keys(), {'missing': list(a.keys()-b.keys())[:20], 'extra': list(b.keys()-a.keys())[:20]}
max_error = 0
for key, (coords, attrs, occluded) in a.items():
    coords2, attrs2, occluded2 = b[key]
    max_error = max(max_error, *[abs(x-y) for x,y in zip(coords, coords2)])
    assert attrs == attrs2, (key, attrs, attrs2)
    assert occluded == occluded2, key
assert max_error <= 0.011, max_error
path = ROOT / 'docs/cvat-server-roundtrip.json'
report = json.loads(path.read_text())
report.update(status='passed', method='Real CVAT server Django import_task_annotations and export_task, isolated task using the existing exact hashed source data; original task annotations untouched', original_tracks=len(original.findall('track')), returned_tracks=len(returned.findall('track')), positive_full_boxes=sum(k[0]=='person_ext' and k[3]=='0' for k in a), positive_visible_boxes=sum(k[0]=='person_visible' and k[3]=='0' for k in a), outside_markers=sum(k[3]=='1' for k in a), all_metadata_equal=True, max_coordinate_error_pixels=max_error, tolerance_pixels=0.011)
path.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
