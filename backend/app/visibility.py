"""Compact, derived per-person visibility; missing boxes do not imply a cause."""
from collections import defaultdict


def visibility_intervals(state, videos):
    people = defaultdict(lambda: {'frames': set(), 'gaps': []})
    for segment in state['segments'].values():
        people[(segment['video_id'], segment['identity_uuid'])]
    for observation in state['observations'].values():
        person = people[(observation['video_id'], observation['identity_uuid'])]
        if observation.get('person_visible'):
            person['frames'].add(observation['frame_index'])
    for gap in state['intervals'].values():
        if gap.get('geometry') == 'person_ext':
            continue
        people[(gap['video_id'], gap['identity_uuid'])]['gaps'].append(gap)
    result = []
    for (video_id, identity_id), person in sorted(people.items()):
        count = videos[video_id]['frame_count']
        cuts = {0, count}
        for frame in person['frames']:
            cuts.update((frame, frame + 1))
        for gap in person['gaps']:
            cuts.update((gap['start'], count if gap['end'] is None else gap['end'] + 1))
        bounds = sorted(c for c in cuts if 0 <= c <= count)
        runs = []
        for start, stop in zip(bounds, bounds[1:]):
            visible = start in person['frames']
            gap = next((g for g in person['gaps'] if g['start'] <= start and (g['end'] is None or start <= g['end'])), None)
            status = 'visible' if visible else 'not_visible'
            basis = 'box_present' if visible else 'explicit_gap' if gap else 'no_box'
            reason = None if visible else gap['reason'] if gap else 'unknown'
            if runs and (runs[-1]['status'], runs[-1]['basis'], runs[-1]['reason']) == (status, basis, reason):
                runs[-1]['end'] = stop - 1
            else:
                runs.append({'video_id': video_id, 'identity_uuid': identity_id,
                             'person_id': state['identities'][identity_id]['person_id'],
                             'start': start, 'end': stop - 1, 'status': status, 'basis': basis, 'reason': reason})
        result.extend(runs)
    return result
