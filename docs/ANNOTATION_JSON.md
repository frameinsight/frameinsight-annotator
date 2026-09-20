# Annotation JSON v2

Wait for **Saved**, then choose **Finish → Finish & choose export → Annotations JSON (recommended) → Prepare download → Download annotations (.json)**. Confirm the actual annotation coverage before finishing. The result is one UTF-8 JSON file with no embedded videos, frames, crops, thumbnails, or model weights. Keep the original footage separately.

The editor exports the selected video (`video_scope`) at one consistent saved revision. The underlying exporter can also export all videos in a project when no video scope is supplied. Saved drafts and single-person work are retained; export does not invent whole-frame reviews.

## One person, two box types

A physical person has one `identity_uuid` and optional numeric `person_id`. Each frame can contain an independently drawn/interpolated **visible** and **extended** rectangle. The extended rectangle describes estimated full extent; it is not itself evidence that the person is visible.

`frame_annotations` gives one row per saved person/frame:

```json
{
  "observation_id": "example-observation",
  "video_id": "example-video",
  "frame_index": 53,
  "timestamp_seconds": 2.85,
  "identity_uuid": "example-person",
  "person_id": 1,
  "boxes": {
    "person_visible": [110, 100, 170, 180],
    "person_extended": [100, 80, 180, 300]
  }
}
```

Either box slot can be `null`. Frames with neither box generally have no observation row; `visibility_intervals` covers their visible status. `state.intervals` preserves explicit deletion barriers for either type.

`annotation_index` provides **one row per present box**, so both boxes can share an `observation_id`, person ID, and source frame. Use `(video_id, frame_index, identity_uuid, box_type)` as the unique box key. For a track, omit `frame_index`. Do not deduplicate by person/frame alone or feed both rectangles to a single-geometry tracker as if they were two people.

## Fields

| Field | Meaning |
|---|---|
| `format`, `schema_version` | `frameinsight.annotations`, version `2` |
| `exported_at`, `media_included` | UTC export time; media is always `false` |
| `project`, `video_scope`, `classes`, `class_colors` | Project metadata/revision, selected video ID, saved class catalog, and persistent default class colors |
| `videos` | Video metadata keyed by video ID: name, dimensions, nominal FPS, source hash and path references |
| `frames` | Exact frame ledger keyed by video ID, including frame index, PTS, time base, seconds and decode status |
| `frame_annotations` | Paired rectangles for each saved person/frame |
| `annotation_index` | Flat per-box rows with geometry, class, color, identity, time and provenance |
| `visibility_intervals` | Compact inclusive visible/not-visible runs for every frame of each associated identity |
| `state` | Saved identities, segments, observations, intervals, links, reviews and proposal reviews |
| `operations` | Historical edits and undo/redo links; these are not current labels |
| `restored_history` | Historical imported records; omitted as `null` for scoped exports |
| `detector` | Legacy suggestion data, separate from accepted annotations |
| `summary` | Counts, including people, observations, visible boxes and extended boxes |

Each `annotation_index` row includes:

- `box_type`: `person_visible` or `person_extended`.
- `geometry_name`: internal slot `person_visible` or `person_ext` (the latter means extended).
- `class_colors` at the document root maps class names to saved default colors. Per-box `color` is authoritative when an annotator has customized a track.
- `class_name`, `color`: settings for this box type, taken from `state.identities[identity_uuid].box_styles`. The same person can have different classes and colors for the two types. Older visible labels fall back to identity-level `class_name` and `color`.
- `box_xyxy`: `[left, top, right, bottom]`; `box_xywh`: `[left, top, width, height]`. Both use unrounded original-image pixels, with origin at the upper-left, x rightwards and y downwards.
- `frame_index`: zero-based source frame; `timestamp_seconds`: actual source time, or `null` when unavailable. Use the ledger rather than estimating from nominal FPS.
- `annotation_type`: `keyframe` or `interpolated`, independently for each type. There are no `missing_box` rows in the v2 flat index.
- `origin`: manual, copied, copied_track, model, interpolated, or null if not recorded. `human_corrected` preserves corrections; corrected interpolation becomes a keyframe while retaining its origin. **Copy Visible → Extended (all frames)** records `copied_track` on each new Extended box, keeps the same identity/ID, and leaves Visible coordinates and provenance unchanged. Unadjusted `copied_track` boxes can be updated by interpolation between Extended corrections; resizing marks them `human_corrected: true`. Older `copied` boxes remain fixed anchors. Class colors are saved per person and box type.
- `protected_from_interpolation`: whether this box is an anchor or part of a historical approved observation.
- `visibility`: based on the presence of **visible** geometry on that frame. An extended-only row can therefore have `visibility: "not_visible"` while still containing a valid extended box.

## Missing boxes and deletion

Visible status is derived from visible geometry: no visible box means `not_visible`, including before the first and after the last visible box. It does not establish physical occlusion, exhaustive review, or a verified negative training example. `visibility_intervals` runs include `start`, `end`, identity/video IDs, `status`, `basis` (`box_present`, `no_box`, `explicit_gap`) and `reason` (normally `unknown` for absence; null for visible).

**Delete** and **Shift+Delete** affect only the selected box type. A deletion creates a `state.intervals` record with `geometry: "person_visible"` or `"person_ext"` to prevent that type from being regenerated across the range. The other type can still exist and interpolate. Legacy intervals without a geometry apply to both types until scoped by editing/conversion. `start` and `end` are inclusive; legacy null ends are open.

Drawing a type again restores that frame and trims its deletion interval. Finite deleted ranges retain their other missing frames; drawing after an old open gap resumes the selected type. Undo restores boxes and intervals together. Eye/focus and **Show both** change display only.

## Reading earlier files and converting earlier work

Previously downloaded v1 files remain unchanged. V1's flat index used the single visible slot and could contain `missing_box` rows. V2 adds `frame_annotations`, emits one flat row per present geometry, and exports both types' independent provenance. Readers must check `schema_version`; the [README Python example](../README.md#read-it-with-python) reads v2.

In the older simplified editor, a track named `person_extended` still stored rectangles in `person_visible`. To convert that work, select that track in the app, press **I**, keep **Extended**, choose the matching existing person ID, and **Save ID**. Conversion moves those original coordinates and provenance to the extended slot and merges complementary boxes on matching frames. It does not guess identity matches. Same-type collisions are rejected without replacement, and the operation can be undone. Until that explicit conversion, the original saved geometry remains as recorded.

## Media and restoration

Names, SHA-256 hashes and source paths identify footage but do not embed it. Downloaded JSON is suitable for analysis or conversion to your trainer's dataset format; training still needs the matching source images. Class names are labels, not cross-camera identity evidence. The app restores **Project backup ZIP** files, not this custom JSON. Keep the ZIP plus original video for reopening work on another computer. Full edit history makes JSON larger than a minimal box list but adds no media.
