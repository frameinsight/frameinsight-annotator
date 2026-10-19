# Multi-camera annotation JSON

Camera sessions export `format: "frameinsight.multicam.annotations"`, `schema_version: 1`. The single-video `frameinsight.annotations` v3 export is unchanged. Check the `format` first when consuming either file.

A camera session groups related recordings and manually reviewed person associations. It does not merge video tracks or copy boxes between cameras. The file contains annotations and video references, never video/image bytes. Editing operations and session edit history are omitted from delivery; a native project backup preserves that history separately.

## Document structure

| Field | Meaning |
|---|---|
| `format`, `schema_version` | Multi-camera envelope and format version. |
| `app_version`, `exported_at` | Producing app version and UTC export timestamp. |
| `media_included`, `history_included` | Both `false` for session delivery. |
| `session` | Session ID, project ID, name, revision, timestamps, cameras, people and assignments. |
| `annotations` | A `frameinsight.annotations` v3 document scoped to this session's camera videos, with additional shared-identity fields on its box/frame rows. |
| `conventions` | Identity scope, timing equation and unassigned/absence semantics. |
| `validation` | The structural result, bound to the session revision, project revision and saved-content fingerprint. It is an export record, not a reusable import approval. |

`annotations` retains the existing v3 `classes`, `class_colors`, `project`, `videos`, `frames`, `state`, `annotation_index`, `frame_annotations`, `presence_intervals`, `visibility_intervals`, `summary` and `conventions`. See [the single-video annotation reference](ANNOTATION_JSON.md) for these fields. All saved tracks in the selected camera videos are included, including unassigned tracks. Display hiding or person focus does not remove annotations from export. Other project videos are excluded.

## Local tracks and shared people

| Reference | Scope and purpose |
|---|---|
| `(video_id, identity_uuid)` | The existing local video track. `person_id` and `track_id` remain its numeric aliases. |
| `(session.id, person_uuid)` | The manually associated person across this session's cameras. |
| `shared_person_id` | The shared person's positive display number, unique within this session. |
| `session.assignments` | Explicit links from a local `(video_id, identity_uuid)` to a shared `person_uuid`. |

Equal track numbers in different videos do **not** imply the same person. Different classes of one local track remain independent rectangles of that track; classes do not create new shared people. Local track numbers are never rewritten just because a person is associated across cameras.

Each shared person has `id`, `person_id`, `name` and `color`. Its `id` is the value used as `person_uuid` in assignments and exported rows. Each camera has `id`, `name`, `video_id` and `offset_seconds`.

An unassigned local track has `person_uuid: null` and `shared_person_id: null`. Keep it unassigned in downstream processing until a human establishes its association. These nulls do not mean the track is invalid or absent.

This shortened excerpt illustrates two different local tracks associated with one person. It omits other required v3 collections and is **not an importable complete file**:

```json
{
  "format": "frameinsight.multicam.annotations",
  "schema_version": 1,
  "media_included": false,
  "history_included": false,
  "session": {
    "id": "session-shop-morning",
    "project_id": "project-shop",
    "mode": "multicamera",
    "name": "Shop morning",
    "revision": 3,
    "created_at": "2026-10-19T08:00:00+00:00",
    "updated_at": "2026-10-19T08:20:00+00:00",
    "cameras": [
      {"id": "camera-entrance", "name": "Entrance", "video_id": "video-a", "offset_seconds": 0.0},
      {"id": "camera-rear", "name": "Rear", "video_id": "video-b", "offset_seconds": 0.5}
    ],
    "people": [
      {"id": "shared-person-uuid", "person_id": 7, "name": "Person 7", "color": "#22d3ee"}
    ],
    "assignments": [
      {"video_id": "video-a", "identity_uuid": "local-track-a", "person_uuid": "shared-person-uuid"},
      {"video_id": "video-b", "identity_uuid": "local-track-b", "person_uuid": "shared-person-uuid"}
    ]
  },
  "annotations": {
    "format": "frameinsight.annotations",
    "schema_version": 3,
    "annotation_index": [
      {
        "observation_id": "observation-a",
        "video_id": "video-a",
        "frame_index": 25,
        "identity_uuid": "local-track-a",
        "person_id": 1,
        "track_id": 1,
        "class_key": "class:Person",
        "class_name": "Person",
        "box_xyxy": [100, 40, 180, 300],
        "timestamp_seconds": 11.0,
        "camera_id": "camera-entrance",
        "person_uuid": "shared-person-uuid",
        "shared_person_id": 7,
        "session_timestamp_seconds": 1.0
      },
      {
        "observation_id": "observation-b",
        "video_id": "video-b",
        "frame_index": 10,
        "identity_uuid": "local-track-b",
        "person_id": 4,
        "track_id": 4,
        "class_key": "class:Person",
        "class_name": "Person",
        "box_xyxy": [600, 75, 720, 340],
        "timestamp_seconds": 100.5,
        "camera_id": "camera-rear",
        "person_uuid": "shared-person-uuid",
        "shared_person_id": 7,
        "session_timestamp_seconds": 1.0
      }
    ]
  }
}
```

In this example the first recorded source timestamps are 10.0 seconds for video A and 100.0 seconds for video B. Both illustrated observations therefore occur at session time 1.0 seconds, although their frame numbers, source timestamps and local IDs differ.

## Timing

Both `annotation_index` and `frame_annotations` retain their original `timestamp_seconds` and gain:

- `camera_id`
- `person_uuid`
- `shared_person_id`
- `session_timestamp_seconds`

The timing equation is:

```text
session_timestamp_seconds = timestamp_seconds
                          - annotations.frames[video_id][0].seconds
                          + camera.offset_seconds
```

Source time comes from the indexed presentation timestamp: `pts × time_base_num / time_base_den`. Frame numbers are zero-based decoded source frames. Different frame rates do not require equal frame numbers. A positive offset means that camera's first frame starts later on the session timeline; a negative offset starts it earlier.

**Sync cameras → Align matching frames** calculates offsets from the moments selected by the annotator. Offsets are constant: they do not compensate for camera clock drift, arbitrary internal recording gaps or uncertain matching events. No wall-clock time is inferred from filenames. Camera playback before its start or after its end displays **No recording**.

If a recording contains several frames with exactly the same presentation timestamp, passive views display the last frame at that instant. In the active camera, use the frame field or previous/next controls to inspect every source frame separately, including frames that share a timestamp. Export preserves all source frame indices and timestamps.

## Read shared tracks with Python

```python
import json
from collections import defaultdict
from pathlib import Path

payload = json.loads(Path("shop-session.json").read_text(encoding="utf-8"))
if payload.get("format") != "frameinsight.multicam.annotations" or payload.get("schema_version") != 1:
    raise ValueError("Unsupported camera session format")

shared_tracks = defaultdict(list)
unassigned = []
for row in payload["annotations"]["annotation_index"]:
    if row["person_uuid"] is None:
        unassigned.append(row)
        continue
    key = (payload["session"]["id"], row["person_uuid"], row["class_key"])
    shared_tracks[key].append(row)

for observations in shared_tracks.values():
    observations.sort(key=lambda row: (
        row["session_timestamp_seconds"], row["video_id"], row["frame_index"]
    ))
```

Retain camera/video IDs when training or evaluating: simultaneous observations from different cameras are valid. Boxes remain in each camera's original image-pixel coordinates. Session synchronization does not transform positions into a common room/world coordinate system.

## Validation and import

From the live grid, choose **Export session**, confirm your visual review and run **Validate camera session**. The checks cover the v3 annotation structure, local IDs, class and frame references, source timing, session person assignments, and agreement between saved state and exported rows. They do not judge image boundaries, class containment, physical identity or box placement.

Unassigned tracks and two local tracks for one shared person on the same camera/frame produce review notes. Simultaneous visibility in different cameras is valid. A missing annotation is not evidence of physical occlusion or a confirmed camera transition. Annotations, session changes and project changes invalidate old export approval.

To import:

1. Prepare the original camera videos in the destination project.
2. Open **Multiple cameras → Import a multi-camera annotation JSON** and choose `.json` or `.json.gz`.
3. Choose **Read camera list**, then explicitly select the matching target video for every source camera.
4. Choose **Import camera session**. Every mapping must use a different target video in the project. Indexed SHA-256 hashes, dimensions, frame counts and frame timestamps must match.
5. Review the restored session and validate again before its next export.

Import is additive and atomic. It creates a new session, new camera/shared-person UUIDs and fresh local annotation entity UUIDs. Numeric shared person IDs are preserved within the new session. Local numeric track IDs are retained when free; collisions receive free numbers. Existing tracks and associations are kept, so importing twice into the same annotated videos creates additional copies rather than replacing or silently merging them. Use unannotated target videos when transferring a completed session.

Import accepts at most 1 GiB of uploaded or decompressed JSON, with a 128 MiB retained-state bound, 49,000 annotation entities per session and the existing native importer limit of 45,000 boxes per camera. Sessions support 2–64 distinct camera videos. File size alone does not establish that an import fits these limits. Incomplete sessions left after video deletion remain saved and can be backed up, but session delivery requires at least two cameras.

Native project backups require all project videos to be ready and hashed. They preserve camera-session metadata and session audit records in addition to local annotation history. Restoration assigns new session/camera/shared-person UUIDs and remaps the restored video references. Exported validation is never treated as permission to skip review after import or restoration.
