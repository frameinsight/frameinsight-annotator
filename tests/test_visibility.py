from backend.app.visibility import visibility_intervals


def state():
    return {'identities': {'p': {'id': 'p', 'person_id': 7}},
            'segments': {'s': {'video_id': 'v', 'identity_uuid': 'p'}},
            'observations': {str(f): {'video_id': 'v', 'identity_uuid': 'p', 'frame_index': f,
                                      'person_visible': [10, 20, 30, 40]} for f in [2, 3, 6]},
            'intervals': {}}


def test_no_box_means_not_visible_on_every_frame_including_before_and_after():
    runs = visibility_intervals(state(), {'v': {'frame_count': 8}})
    assert [(r['start'], r['end'], r['status']) for r in runs] == [
        (0, 1, 'not_visible'), (2, 3, 'visible'), (4, 5, 'not_visible'),
        (6, 6, 'visible'), (7, 7, 'not_visible')]
    assert all(r['reason'] == 'unknown' and r['basis'] == 'no_box' for r in runs if r['status'] == 'not_visible')
    assert all(r['person_id'] == 7 for r in runs)


def test_explicit_causes_are_preserved_but_missing_boxes_never_invent_occlusion():
    d = state()
    d['intervals']['g'] = {'video_id': 'v', 'identity_uuid': 'p', 'start': 4, 'end': 4, 'reason': 'outside'}
    runs = visibility_intervals(d, {'v': {'frame_count': 8}})
    assert next(r for r in runs if r['start'] == 4)['reason'] == 'outside'
    assert next(r for r in runs if r['start'] == 5)['reason'] == 'unknown'


def test_empty_boxes_and_new_people_are_not_visible_without_affecting_other_videos():
    d = state()
    d['observations']['2']['person_visible'] = None
    d['identities']['new'] = {'id': 'new', 'person_id': None}
    d['segments']['new'] = {'video_id': 'other', 'identity_uuid': 'new'}
    runs = visibility_intervals(d, {'v': {'frame_count': 8}, 'other': {'frame_count': 3}})
    assert [r for r in runs if r['video_id'] == 'other'] == [
        {'video_id': 'other', 'identity_uuid': 'new', 'person_id': None,
         'start': 0, 'end': 2, 'status': 'not_visible', 'basis': 'no_box', 'reason': 'unknown'}]
    assert next(r for r in runs if r['video_id'] == 'v')['end'] == 2
