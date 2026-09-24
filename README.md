# Frameinsight

**Annotate video, keep identities consistent, and review the result before export.**

[![Release](https://img.shields.io/github/v/release/frameinsight/frameinsight-annotator)](https://github.com/frameinsight/frameinsight-annotator/releases/latest)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/frameinsight/frameinsight-annotator?style=flat)](https://github.com/frameinsight/frameinsight-annotator/stargazers)

Frameinsight is a local video annotation app for detection and tracking datasets. Draw a box, skip ahead, and adjust it; editable interpolation fills the frames between your corrections. One tracked object can have any number of named box classes, each with independent geometry. Manual annotation works offline without a GPU or model downloads.

## Download and install

| Platform | Download | Installation |
|---|---|---|
| Windows 10 / 11, 64-bit | [Window_setup.exe](https://github.com/frameinsight/frameinsight-annotator/releases/latest/download/Window_setup.exe) | Open the installer, then launch Frameinsight from the desktop or Start menu. |
| Debian 12+ / Ubuntu 24.04+, 64-bit | [Latest Debian package](https://github.com/frameinsight/frameinsight-annotator/releases/latest) | Download `frameinsight_<version>_amd64.deb`, open it with your software installer, then launch Frameinsight. |

The installers include the app and its runtime. No Python, Node.js, terminal setup, GPU, or model is needed for annotators. Packages are currently unsigned; see the [Windows guide](docs/WINDOWS.md) and [Linux guide](docs/LINUX.md). Release assets include SHA-256 checksums and an update manifest.

At startup, Frameinsight checks this repository’s latest stable release. When an update is available, read the release notes and choose **Update** or **Skip for now**. Downloads are checksum-verified; **Install update** saves your work and hands off to the system installer. Linux may request your normal installation permission. Project data lives outside the installed program. Offline checks never prevent annotation. Copies run from source offer a manual installer download instead of replacing the checkout.

## A simple annotation workflow

1. Choose **New project**, enter its name and class names (one per line). Open the project, choose **New video**, and upload a video or enter its local path.
2. Go to the first frame where an object appears. Press **N** for a new track, choose a class, and draw its box. A free numeric ID is assigned automatically.
3. Move forward with **F** or **Shift+F**, then move or resize the box. Interpolation fills between your drawn/corrected boxes. Inspect the in-between frames and correct any drift.
4. Keep the same track selected to annotate another class. Choose its class button and draw, or open **Copy to class…**, choose **Source class** and **Target class**, then click **Copy boxes**. Existing target boxes are kept. Adjust the copies at keyframes.
5. Use track or class eyes to hide clutter without deleting labels. **Delete range** removes only the selected class. **Restore range** repairs accidental gaps without redrawing every frame.
6. Edits save automatically. **Ctrl+S** saves explicitly. **Ctrl+Z** undoes a complete action, including its generated boxes.
7. Choose **Finish → Review in editor** to check the existing canvas playback at **0.125×, 0.25×, 0.5× or 1×**. Correct mistakes, click **Finish → I reviewed — continue**, then choose coverage and **Run annotation validation** on the **Validate & export** page. Export annotation-only JSON after a pass.

Interpolation and background dimming are always on. The app fills between corrections and keeps the selected track's boxes bright while dimming the surrounding picture.

Read the [beginner guide](docs/USER_GUIDE.md) or [shortcut list](docs/SHORTCUTS.md). Every essential shortcut has an on-screen control.

### Rename a project or its classes

Open **Project settings** from a project card or the project's video library. In the annotation editor, use the settings icon beside **New video**, or **Edit classes** above the canvas. Change the project name or class names and click **Save changes**. You can also add classes here.

Names update across all videos, saved boxes and future exports in that project; track IDs, coordinates, colors and hidden ranges stay intact. On **Validate & export**, choose **Edit project & classes** to make the same changes. Run validation again after renaming; you do not need to watch the video again just because a name changed. Already downloaded files are not rewritten.

A settings change resets the current Undo/Redo stacks, while saved edit history remains available through **Restore range**. Saving unchanged settings does not reset them.

## What is included

- Exact source-frame navigation and timestamps, zoom/pan, box movement and resizing.
- Compact icon toolbar for class copying, range deletion/restoration, select/draw/hand, zoom and edit history. Hover hints explain each icon; right-click a box or its class/ID label for the same context menu.
- Large color-coded Present/Hidden frame bar; more room for video without thumbnail clutter.
- One stable object identity with multiple user-defined classes; no fixed Visible/Extended slots in the UI.
- Independent interpolation, copying, deletion and recovery for each class.
- Editable project and class names, including during final review, with existing annotations updated together.
- Compact searchable track list, hide/focus controls, and automatic background dimming.
- Automatic saving, undo/redo, recovery journals, and native project backups.
- Review in the existing annotation canvas with all tracks, frame stepping, and **0.125× / 0.25× / 0.5× / 1×** playback.
- Structural validation of IDs, references, coordinate data, timestamps, JSON and export counts. It needs no video rendering or source-file hashing. Saved changes require revalidation.
- Windows and Debian installers with release notes and opt-in updates.

The app does not recognize objects or guarantee identity correctness. Human review checks placement, identity swaps, missed objects and interpolation. Direction labels, movement prediction and cross-camera identity association are not implemented. This is a localhost app, without network deployment or multi-user authentication.

## Team annotation tools

- Switch **View by class / View by track** in the canvas right-click menu. Class colors remain the default; track colors are a display preference, not changes to labels or export colors.
- Diamonds mark anchor frames for the selected track/class. Use **Previous/Next keyframe** or **[ / ]** to jump between them. Generated boxes have no diamond until corrected. Single-frame copies and imported boxes may also be anchors.
- Press **I** to edit the current track’s ID, class and color. IDs already used by another track are rejected. **B + drag** replaces the current box; **C** only copies into an empty frame.
- **Import annotations → Frameinsight annotations — JSON** previews a single-video v2/v3 export before adding it. Numeric IDs are retained when free; collisions are explicitly remapped. Original frame dimensions/count and available video hashes must match. Boxes, class styles, anchor provenance and deleted intervals are retained; review/validation and old edit history are not restored. Existing tracks remain intact; Undo reverses the import.
- Empty projects remain reusable after video deletion and are clearly labeled.

## How to use annotation JSON

After **Finish → I reviewed — continue → Run annotation validation**, use **Prepare validated JSON → Download annotations (.json)**. The file includes current annotations, source metadata, validation, and edit history. It embeds **no video, image, crop or thumbnail**. Keep the original video separately; its recorded name and SHA-256 hash identify the matching footage. **Review in editor** shows all saved tracks and classes; display hiding never removes boxes from export.

New exports use `format: "frameinsight.annotations"`, `schema_version: 3`.

| Field | Meaning |
|---|---|
| `annotation_index` | One row per present box, with class, track, frame, coordinates and provenance. |
| `identity_uuid` | Stable internal identity. Use it to group one physical object. |
| `track_id`, `person_id` | The same positive display number; `person_id` remains for compatibility. Numbers are scoped to a project, not a cross-camera match. |
| `class_key`, `class_name` | The rectangle channel and its training label. Include the class key when grouping independent box tracks. |
| `frame_index`, `timestamp_seconds` | Zero-based decoded source frame and exact source time. |
| `box_xyxy`, `box_xywh` | Original-image pixel coordinates: `[left, top, right, bottom]` and `[left, top, width, height]`. |
| `frame_annotations` | One row per object/frame, with a `boxes` map containing the present class keys. |
| `presence_intervals` | Inclusive per-class runs of `present` / `absent` boxes. Absence does not prove physical occlusion or a verified negative example. |
| `validation` | Revision-bound structural checks, human visual confirmation, and declared annotation coverage. |
| `state`, `operations` | Saved entities and edit history. Historical/deleted boxes are **not current training labels**. |

### Read it with Python

This example uses only Python’s standard library. It accepts v2 files as well as the new v3 format.

```python
import json
from collections import defaultdict
from pathlib import Path

annotation = json.loads(Path("annotations.json").read_text(encoding="utf-8"))
if annotation.get("format") != "frameinsight.annotations" or annotation.get("schema_version") not in (2, 3):
    raise ValueError("Unsupported annotation format")

tracks = defaultdict(list)
for row in annotation["annotation_index"]:
    if not row.get("box_xyxy"):
        continue
    channel = row.get("class_key", row.get("geometry_name", row["box_type"]))
    tracks[(row["video_id"], row["identity_uuid"], channel)].append(row)

for (video_id, identity_uuid, channel), rows in tracks.items():
    rows.sort(key=lambda row: row["frame_index"])
    video = annotation["videos"][video_id]
    print(video["name"], identity_uuid, channel, len(rows), "boxes")
    for row in rows:
        print(row["frame_index"], row["timestamp_seconds"],
              row["person_id"], row["class_name"], row["box_xyxy"])
```

For detection training, extract the matching original source frames and convert class labels and coordinates to your trainer’s format. This JSON is not directly a YOLO dataset. Maintain one consistent class mapping across all training videos. For tracking, group by identity and choose the appropriate class; two classes of the same object are not two objects. Use exact source timestamps for motion analysis. Partial annotation is not exhaustive ground truth.

See the [complete JSON reference](docs/ANNOTATION_JSON.md), including legacy compatibility. To reopen editable work on another computer, use **Help → Back up project** and keep the ZIP with the original video; annotation JSON can also be imported onto the matching original video, but does not restore old undo history or validation. Use a project backup for full recovery.

## Run from source

Tested with Python 3.13 and Node.js 20. You need Python with `venv`/pip and Node.js/npm.

```bash
./scripts/setup.sh
./scripts/start.sh
# Open http://127.0.0.1:8765
```

On Linux, `./scripts/start-background.sh` runs a user systemd service; `./scripts/stop.sh` stops it. Data defaults to `.frameinsight/`. `FRAMEINSIGHT_DATA`, `FRAMEINSIGHT_WORKSPACE`, and `FRAMEINSIGHT_MODELS` override paths. Source control excludes footage, databases, local backups, weights and installer binaries. Lossless frame caches can use substantially more disk than the source video.

```bash
.venv/bin/python scripts/make_fixture.py
.venv/bin/python -m pytest tests -q
npm --prefix frontend test
npm --prefix frontend run build
```

Browser tests need an **isolated** server at `127.0.0.1:5173` and Chrome. Set a separate `FRAMEINSIGHT_DATA` directory: tests create synthetic annotation projects.

```bash
FRAMEINSIGHT_TEST_URL=http://127.0.0.1:5173 npm --prefix frontend run test:e2e
```

Build and release instructions are in [Windows packaging](docs/WINDOWS.md), [Debian packaging](docs/LINUX.md) and the [release workflow](.github/workflows/desktop-release.yml). See the [3.4.1 verification record](docs/releases/v3.4.1-acceptance.md) for test coverage and limits.

## Contributing

Please [report bugs](https://github.com/frameinsight/frameinsight-annotator/issues) with the version shown in **Help → About**, your operating system, and steps to reproduce. Use a small synthetic example when possible; do not upload private footage or annotations. See [CONTRIBUTING.md](CONTRIBUTING.md) before a pull request.

If Frameinsight helps your annotation work, a GitHub star helps others find it.

## License

[MIT](LICENSE). Bundled dependencies retain their own licenses; installer notices document them.


### Projects and annotation imports

The home screen groups recordings by project. Videos in a project share a class catalog and its ordering; each video shows only its own tracks. Existing projects and annotations stay available. Deleting the last video leaves an empty project you can reuse.

To import labels:

1. Open the correct project and add the matching original video. Wait for preparation to finish.
2. Click **Import annotations** in the playback controls at the center of the timeline.
3. Select **YOLO detection**, **YOLO with track IDs**, or **MOT 1.1 ground truth**. Upload a ZIP, or a single TXT file.
4. Check the source frame numbering. App frames always start at 0. For MOT, also choose whether coordinates start at 0 or 1.
5. Click **Preview import**, check the box/track counts, frame range, warnings and ID mapping, then **Add annotations**.
6. Play and inspect the imported boxes. Move/resize them normally. **Ctrl+Z** undoes the whole import. **K** can fill missing frames between imported boxes when you want interpolation; import itself preserves unlabeled frames as Hidden.

Supported layouts and limits:

- YOLO labels contain `class_id center_x center_y width height` in normalized image coordinates. The explicit tracked variant adds an integer `track_id` as column six. Confidence scores are not track IDs. Label filenames must end in the source frame number, such as `frame_000000.txt`. ZIP folders such as `labels/train` and `obj_train_data` are supported. Import one video's labels at a time.
- Class names come from `obj.names`, `classes.txt`, or YAML `names`. Without those, YOLO uses the project's class order. You can override names in the dialog, one per line in source class-ID order.
- Ordinary five-column YOLO contains **no identity information**. Each detection becomes a separate track; the importer cannot know which detections belong to the same object. Use tracked YOLO or MOT for existing tracking work.
- MOT accepts `gt/gt.txt` and optional `gt/labels.txt`, or a standalone ground-truth TXT: `frame,id,left,top,width,height,included,class_id,visibility`. Class IDs start at 1; without class names, standard MOT labels are used. Rows with `included=0` are excluded. Scored MOT tracking-result files are not supported as ground truth. Visibility is retained in the observation evidence note.
- Existing tracks are never replaced or automatically merged. Positive source IDs are preserved when unused in the project; colliding IDs and YOLO ID 0 receive a new positive ID shown in the preview. Separate classes with the same source ID share one track.
- Upload limit: 50 MB; archive text limit: 64 MB; at most 45,000 boxes and 49,000 new entities per import. Oversized, ambiguous or invalid imports fail without changing annotations. Out-of-image boxes require explicit clipping; boxes fully outside the image are rejected.
- Preview checks structure, not visual identity accuracy or whether the selected video matches the labels. Use **Finish** for visual review and final JSON validation before training. Imports remain local; no videos or annotations are sent to a cloud service.

Format references: [CVAT YOLO](https://docs.cvat.ai/docs/dataset_management/formats/format-yolo/), [CVAT Ultralytics YOLO](https://docs.cvat.ai/docs/dataset_management/formats/format-yolo-ultralytics/), [CVAT MOT](https://docs.cvat.ai/docs/dataset_management/formats/format-mot/).
