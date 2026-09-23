# Annotation JSON v3

Choose **Finish → Review in editor** to inspect the existing canvas playback. Then choose **Finish → I reviewed — continue**. On **Validate & export**, select coverage and **Run annotation validation**. After a pass, **Prepare validated JSON → Download annotations (.json)** creates a UTF-8 file containing no embedded media. Keep the original video separately.

The selected-video export is one saved, reviewed snapshot. Its JSON includes `format: "frameinsight.annotations"`, `schema_version: 3`, `app_version`, `exported_at`, `video_scope`, `media_included: false`, project metadata, class catalog/colors, video metadata, exact frame ledgers, current annotations and relevant history.

## One object, many classes

Every object has one `identity_uuid` and a positive numeric `track_id`. `person_id` is an equal compatibility alias. Any number of named classes can have independent rectangles under that identity. The app supports up to 100 project class names.

For example, `frame_annotations` can contain:

```json
{
  "observation_id": "example-observation",
  "video_id": "example-video",
  "frame_index": 53,
  "timestamp_seconds": 2.85,
  "identity_uuid": "example-object",
  "track_id": 1,
  "person_id": 1,
  "boxes": {
    "class:person_visible": [110, 100, 170, 180],
    "class:person_extended": [100, 80, 180, 300],
    "class:head": [120, 85, 155, 120]
  }
}
```

Class names are examples, not reserved UI modes. An omitted class has no box on that frame. Frames with no boxes usually have no observation row; consult `presence_intervals` for absence. Never deduplicate by identity/frame alone: that would discard additional classes.

## The flat index

`annotation_index` contains one row per present box. Its unique key is `(video_id, frame_index, identity_uuid, class_key)`. For a rectangle’s track, omit the frame index.

| Field | Meaning |
|---|---|
| `observation_id` | Shared by all classes of the identity on this source frame. |
| `class_key` | Rectangle channel: new work uses `class:<name>` and changes its key when that class is renamed; legacy work retains `person_visible` or `person_ext`. |
| `class_name`, `color` | Authoritative label and display color, including per-track overrides. Use the name for your training label, not a storage key. |
| `track_id`, `person_id`, `identity_uuid` | Shared object identity. Display numbers are scoped to a project. |
| `frame_index`, `timestamp_seconds` | Zero-based source frame and actual source time. Use the ledger rather than nominal FPS for variable-frame-rate footage. |
| `box_xyxy` | `[left, top, right, bottom]`, unrounded original-image pixels. Origin is top-left, x right, y down. |
| `box_xywh` | `[left, top, width, height]` in the same pixels. |
| `annotation_type` | `keyframe`, `interpolated`, or `generated` (uncorrected copied/model track boxes). Manual corrections become anchors for the selected class only. |
| `origin`, `human_corrected` | Provenance: manual, copied, copied_track, interpolated, historical model origins, or null. |
| `protected_from_interpolation` | Whether the saved rectangle is protected as an anchor or historical approved observation. |
| `presence` | `present`; absent classes have no positive row. |
| `box_type`, `geometry_name`, `visibility` | Legacy compatibility fields. New readers should prefer `class_key` and per-class presence. Dynamic classes have no inferred physical `visibility`. |

In **Copy to class…**, choose **Source class** and **Target class**, then **Copy boxes**. This creates `copied_track` rectangles throughout the selected video where source boxes exist and target boxes are missing. Existing target boxes stay. Unadjusted copies adapt between later target corrections; corrected boxes remain anchors. Source coordinates and identity stay unchanged. The whole copy is undoable. Interpolation is always on.

## Presence, deletion and display

`presence_intervals` contains inclusive `start`/`end` frame ranges per video, identity and class. Each row has the ID aliases, `class_key`, `class_name`, `status` (`present` or `absent`), `basis` (`box_present`, `no_box`, `explicit_gap`) and `reason` (null for present; normally unknown for absence).

No box means no annotation of that class. It does **not** prove physical occlusion, absence from the scene or exhaustive negative review. Before/after appearances and unfinished work can all have absent annotations.

`state.intervals` preserves explicit interpolation barriers. `geometry` names the affected class key; a legacy null geometry applies to all classes. Bounds are inclusive; a null end is open. Delete/Shift+Delete affect only the selected class. Drawing again restores that single frame and trims its interval; it does not silently refill the deleted interior.

**Restore range** removes a selected barrier and fills between current anchors, or recovers original coordinates from history without overwriting newer boxes. Unrecoverable frames remain blocked. Undo restores the previous boxes and intervals together.

Class and track eyes, focus and automatic background dimming change only display. **Review in editor** shows every saved track and class. JSON includes every saved box regardless of display hiding.

## Validation and review

New `validation` records use `mode: "structural"` and include checks, errors, notes, counts, the saved revision, video/project IDs, validation ID, app version, annotation snapshot hash, declared coverage and the annotator’s confirmation. A rendered-review job ID is not required.

Checks cover JSON serialization and schema, entity references, unique positive track numbers, class-channel consistency, finite positive-area rectangle data, frame timestamps and index/count agreement. Validation makes no judgment about image bounds, one class containing another, box placement or real-world identity. Coverage values retain `all_people` / `selected_people` for compatibility; the UI labels these all objects / selected objects.

Visual review uses the existing editor with **0.125× / 0.25× / 0.5× / 1×** playback. Validation freezes only annotation JSON; it does not render video, decode footage or rehash the source file. Changed saved annotations, relevant metadata or an incompatible app version invalidate the proof. Export and downloads reject stale validation. Restored projects require a fresh validation.

Older exports may contain a rendered-review job ID and review-video hash. Those remain compatibility metadata; new structural validation does not require them.

## Project and class renaming

**Project settings** applies class renames across current annotations and saved recovery history, including class keys, labels and interpolation barriers. IDs, coordinates, timestamps and colors stay unchanged. Legacy geometry slots keep their keys while their explicit class labels update. Renames cannot silently combine two classes.

`project_settings_history` records the old/new project names, class-name mapping, added classes, revisions and change time. Earlier native-archive audit entries remain in `restored_history`. Run validation again after changing settings; names alone do not require another watch-through. Newly downloaded JSON uses the updated names. Previously downloaded files are unchanged.

## Compatibility with earlier work

Opening existing work retains its legacy fields and edit history. An explicit class rename updates the labels in recovery history as described above. Legacy channels remain `person_visible` / `person_ext` in v3 indexes and `frame_annotations.boxes`; **v2** used `person_extended` as its paired-view extended key. Always check `schema_version`.

- V1 used a single visible slot and could include `missing_box` rows.
- V2 exported two independent geometry slots and a paired frame view.
- V3 supports arbitrary named channels, adds `track_id`, `class_key` and `presence_intervals`, and makes the frame box map generic.

`visibility_intervals`, `visible_boxes` and `extended_boxes` remain legacy compatibility fields; they do not describe arbitrary named classes. `summary.boxes` and `summary.boxes_by_class` cover all present channels. `box_type: "person_extended"` remains an alias of legacy `person_ext` in flat rows.

The app can explicitly join old separate tracks using **I → Existing track ID → Save ID**, including the old extended-class conversion. It never guesses which objects match. Conflicting boxes of the same class on one frame are rejected without replacement; merging can be undone.

## Training and editable backups

Use current `annotation_index`, not historical coordinates in `operations`, for positive training labels. Extract source images separately and convert labels to your trainer’s format. Choose one consistent class mapping across the dataset. Do not treat two classes of one identity as two objects, or a partially annotated frame as exhaustive detection ground truth. A numeric ID alone does not link unrelated projects or cameras.

`videos` includes names, hashes and local path metadata, without binary footage. `frames` preserves source PTS/time bases/times. `state` includes saved entities; `operations` contains before/after values, undo links and recorded server times. `restored_history` is null in selected-video deliveries. Legacy detector data is separate from accepted labels.

Custom annotation JSON is a delivery format. To reopen editable work elsewhere, keep a **Project backup ZIP** plus original videos. Native backup schema v2 supports named classes and restore accepts both v1 and v2. Legacy CVAT/YOLO/MOT profiles reject dynamic-class data rather than silently omitting it; use the v3 JSON for conversion.
