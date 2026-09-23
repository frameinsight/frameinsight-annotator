"""Authoritative domain validation; containment tolerance is 0.01 source pixels."""
import math
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

from .geometry import box_items, get_box, validate_key

TOLERANCE = 0.01
Geometry = tuple[float, float, float, float]
class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')
class BoxStyle(Strict):
    class_name: str = Field(min_length=1, max_length=80, pattern=r'.*\S.*')
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
class Identity(Strict):
    box_styles: dict[str, BoxStyle] = Field(default_factory=dict)
    id: str
    person_id: int | None = Field(default=None, gt=0)
    name: str = ''
    class_name: str = Field(default='person_visible', min_length=1, max_length=80, pattern=r'.*\S.*')
    color: str = Field(default='#baa7ff', pattern=r'^#[0-9a-fA-F]{6}$')
    @field_validator('box_styles')
    @classmethod
    def valid_styles(cls, styles):
        for key, style in styles.items():
            validate_key(key)
            if key.startswith('class:') and style.class_name != key[6:]:
                raise ValueError('Named class style must match its class channel')
        return styles
class Segment(Strict):
    id: str
    video_id: str
    identity_uuid: str
    start: int = Field(ge=0)
    end: int | None = Field(default=None, ge=0)
    status: Literal['verified', 'unresolved'] = 'verified'
class Provenance(Strict):
    origin: Literal['manual', 'model', 'model_track', 'copied', 'copied_track', 'interpolated'] = 'manual'
    proposal_id: str | None = None
    human_corrected: bool = False
class Observation(Strict):
    id: str
    video_id: str
    frame_index: int = Field(ge=0)
    identity_uuid: str
    segment_id: str
    boxes: dict[str, Geometry] = Field(default_factory=dict, max_length=100)
    person_ext: Geometry | None = None
    person_visible: Geometry | None = None
    full_quality: Literal['unset', 'observed', 'estimated', 'unknown'] = 'unset'
    occluded: bool | None = None
    truncated: bool | None = None
    geometry_link: Literal['independent', 'equal'] = 'independent'
    review_state: Literal['draft', 'needs_review', 'approved'] = 'draft'
    evidence_note: str = ''
    provenance: dict[str, Provenance] = Field(default_factory=dict)
    @field_validator('boxes')
    @classmethod
    def valid_boxes(cls, boxes):
        for key in boxes:
            validate_key(key, dynamic_only=True)
        return boxes
    @field_validator('provenance')
    @classmethod
    def valid_provenance(cls, value):
        for key in value:
            validate_key(key)
        return value
class Interval(Strict):
    geometry: str | None = None
    @field_validator('geometry')
    @classmethod
    def valid_geometry(cls, value):
        return validate_key(value) if value is not None else None
    id: str
    video_id: str
    identity_uuid: str
    start: int = Field(ge=0)
    end: int | None = Field(default=None, ge=0)
    reason: Literal['occlusion', 'outside', 'unavailable', 'unknown']
    evidence_note: str = ''
class Link(Strict):
    id: str
    source: str
    target: str
    relation: Literal['same', 'different', 'unresolved']
    evidence_note: str
class Review(Strict):
    id: str
    video_id: str
    frame_index: int = Field(ge=0)
    complete: bool = False
    checked_all_people: bool = False
    note: str = ''
class ProposalReview(Strict):
    id: str
    video_id: str
    frame_index: int = Field(ge=0)
    proposal_id: str
    decision: Literal['rejected'] = 'rejected'
    reason: str = Field(min_length=1)
MODELS = {'identities': Identity, 'segments': Segment, 'observations': Observation,
          'intervals': Interval, 'links': Link, 'reviews': Review, 'proposal_reviews': ProposalReview}
class Change(Strict):
    collection: Literal['identities', 'segments', 'observations', 'intervals', 'links', 'reviews', 'proposal_reviews']
    id: str
    before: dict | None
    after: dict | None
class Operation(Strict):
    id: str = Field(min_length=1, max_length=100)
    base_revision: int = Field(ge=0)
    compensates: str | None = None
    label: str = Field(max_length=200)
    video_id: str | None = None
    frame_index: int | None = None
    changes: list[Change] = Field(max_length=50000)

def issues(o: dict, *, visible_only: bool = False) -> list[str]:
    result = []
    a, b = o.get('person_ext'), o.get('person_visible')
    if visible_only or o.get('boxes'):
        return [] if any(box_items(o)) else ['Missing box']
    if b is None: result.append('Missing B (visible extent)')
    if o['full_quality'] == 'unknown':
        if a is not None: result.append('Unknown full extent must have no A')
        if not o['evidence_note'].strip(): result.append('Unknown A needs an evidence note')
    elif a is None: result.append('Missing A: draw it or mark unknown')
    if o['full_quality'] == 'unset': result.append('Review full extent quality')
    if o['occluded'] is None: result.append('Review external occlusion')
    if o['truncated'] is None: result.append('Review image-border truncation')
    if a and b and (b[0] < a[0]-TOLERANCE or b[1] < a[1]-TOLERANCE or b[2] > a[2]+TOLERANCE or b[3] > a[3]+TOLERANCE):
        result.append('B extends outside A')
    if o['geometry_link'] == 'equal':
        if a != b or a is None: result.append('Equal link requires identical A and B')
        if o['occluded'] is not False: result.append('Equal link requires occlusion Off')
    return result

def validate_state(state: dict, videos: dict, *, visible_only: bool = False, structural_only: bool = False):
    numbers, seen = set(), set()
    for person in state['identities'].values():
        pid = person['person_id']
        if pid is not None and pid in numbers: raise ValueError(f'Person ID {pid} is already assigned; merge explicitly')
        if pid is not None: numbers.add(pid)
    for collection in ('segments', 'intervals', 'observations', 'reviews', 'proposal_reviews'):
        for e in state.get(collection, {}).values():
            v = videos.get(e['video_id'])
            if not v: raise ValueError('Unknown video')
            if 'identity_uuid' in e and e['identity_uuid'] not in state['identities']: raise ValueError('Missing identity')
            start, end = e.get('start', e.get('frame_index')), e.get('end')
            if start >= v['frame_count'] or (end is not None and (end < start or end >= v['frame_count'])):
                raise ValueError('Frame or interval outside decoded frame ledger')
    for o in state['observations'].values():
        key = (o['video_id'], o['frame_index'], o['identity_uuid'])
        if key in seen: raise ValueError('Two observations have the same identity on one frame')
        seen.add(key)
        s = state['segments'].get(o['segment_id'])
        if not s or s['identity_uuid'] != o['identity_uuid'] or s['video_id'] != o['video_id']:
            raise ValueError('Observation must belong to its identity and video segment')
        if o['frame_index'] < s['start'] or (s['end'] is not None and o['frame_index'] > s['end']):
            raise ValueError('Observation lies outside its visible segment')
        for gap in state['intervals'].values():
            if gap['identity_uuid'] == o['identity_uuid'] and gap['video_id'] == o['video_id'] and gap['start'] <= o['frame_index'] and (gap['end'] is None or o['frame_index'] <= gap['end']):
                if (get_box(o, gap['geometry']) if gap.get('geometry') else any(box_items(o))):
                    raise ValueError('A missing-box gap cannot contain that box type')
        v = videos[o['video_id']]
        for name, box in box_items(o):
            if structural_only:
                if box and (len(box) != 4 or not all(type(x) in (int, float) and math.isfinite(x) for x in box) or not (box[0] < box[2] and box[1] < box[3])):
                    raise ValueError('Box coordinates must be four finite numbers describing a positive-area rectangle')
            elif box and (not all(math.isfinite(x) for x in box) or not (0 <= box[0] < box[2] <= v['width'] and 0 <= box[1] < box[3] <= v['height'])):
                raise ValueError('Box must have positive area within source-image boundaries')
        if not structural_only and o['review_state'] == 'approved' and issues(o, visible_only=visible_only): raise ValueError('; '.join(issues(o, visible_only=visible_only)))
        if not structural_only and o['review_state'] == 'approved' and s['status'] != 'verified': raise ValueError('Resolve segment identity before approval')
    for link in state['links'].values():
        if link['source'] not in state['identities'] or link['target'] not in state['identities'] or link['source'] == link['target']:
            raise ValueError('Identity link requires two existing distinct identities')
        if not structural_only and not link['evidence_note'].strip(): raise ValueError('Identity decisions require evidence')
    for r in state['reviews'].values():
        if r['complete'] and not structural_only:
            if not r['checked_all_people']: raise ValueError('Confirm the full-frame completeness check')
            obs = [o for o in state['observations'].values() if o['video_id'] == r['video_id'] and o['frame_index'] == r['frame_index']]
            if any((not visible_only and o['review_state'] != 'approved') or issues(o, visible_only=visible_only) or state['segments'][o['segment_id']]['status'] != 'verified' for o in obs): raise ValueError('Resolve invalid observations and identities before marking the frame complete')
