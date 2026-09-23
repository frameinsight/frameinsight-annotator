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

1. Choose **New video**, enter your class names, and upload a video.
2. Go to the first frame where an object appears. Press **N** for a new track, choose a class, and draw its box. A free numeric ID is assigned automatically.
3. Move forward with **F** or **Shift+F**, then move or resize the box. Interpolation fills between your drawn/corrected boxes. Inspect the in-between frames and correct any drift.
4. Keep the same track selected to annotate another class. Choose its class button and draw, or use **Copy to class…** to copy the current class across the video. Existing destination boxes are kept. Adjust the copies at keyframes.
5. Use track or class eyes to hide clutter without deleting labels. **Delete range** removes only the selected class. **Restore range** repairs accidental gaps without redrawing every frame.
6. Edits save automatically. **Ctrl+S** saves explicitly. **Ctrl+Z** undoes a complete action, including its generated boxes.
7. Choose **Finish**, prepare the complete annotated review video, watch at normal or slow speed, confirm the coverage, and run validation. Export annotation-only JSON after validation passes.

Read the [beginner guide](docs/USER_GUIDE.md) or [shortcut list](docs/SHORTCUTS.md). Every essential shortcut has an on-screen control.

## What is included

- Exact source-frame navigation and timestamps, zoom/pan, box movement and resizing.
- Canvas select/draw/hand tools and a context-sensitive right-click menu.
- Large color-coded Present/Hidden frame bar; more room for video without thumbnail clutter.
- One stable object identity with multiple user-defined classes; no fixed Visible/Extended slots in the UI.
- Independent interpolation, copying, deletion and recovery for each class.
- Compact searchable track list, hide/focus controls, and optional background dimming.
- Automatic saving, undo/redo, recovery journals, and native project backups.
- Full-video review with all saved boxes and IDs, frame stepping, and **0.5× / 0.25× / 0.125×** playback.
- Structural validation of IDs, references, coordinates, timestamps, JSON and export counts. A changed annotation invalidates its previous review proof.
- Windows and Debian installers with release notes and opt-in updates.

The app does not recognize objects or guarantee identity correctness. Human review checks placement, identity swaps, missed objects and interpolation. Direction labels, movement prediction, cross-camera identity association and direct custom-JSON import are not implemented. This is a localhost app, without network deployment or multi-user authentication.

## How to use annotation JSON

The **Finish → Prepare validated JSON → Download annotations (.json)** file includes current annotations, source metadata, validation, and edit history. It embeds **no video, image, crop or thumbnail**. Keep the original video separately; its name and SHA-256 hash identify the matching footage. Hiding boxes in the editor does not remove them from review or export.

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

See the [complete JSON reference](docs/ANNOTATION_JSON.md), including legacy compatibility. To reopen editable work on another computer, use **Help → Back up project** and keep the ZIP with the original video; the custom JSON is a delivery format, not a project backup.

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

Build and release instructions are in [Windows packaging](docs/WINDOWS.md), [Debian packaging](docs/LINUX.md) and the [release workflow](.github/workflows/desktop-release.yml). See the [3.0.0 verification record](docs/releases/v3.0.0-acceptance.md) for test coverage and limits.

## Contributing

Please [report bugs](https://github.com/frameinsight/frameinsight-annotator/issues) with the version shown in **Help → About**, your operating system, and steps to reproduce. Use a small synthetic example when possible; do not upload private footage or annotations. See [CONTRIBUTING.md](CONTRIBUTING.md) before a pull request.

If Frameinsight helps your annotation work, a GitHub star helps others find it.

## License

[MIT](LICENSE). Bundled dependencies retain their own licenses; installer notices document them.
