# Changelog

## 3.8.0

Play a source video and press **C** to cut without stopping playback. Select sections to remove/restore, undo or redo edits, then combine the remaining sections into a new MP4 at the original resolution. Includes frame stepping, slow playback, migration of saved 3.7.0 selections and optional playback previews for unsupported source formats. See the [release notes](docs/releases/v3.8.0.md).

## 3.7.0

Standalone **Trim sections** prepares a separate MP4 before annotation. Drag handles to keep multiple sections; the output preserves source dimensions, aspect ratio, selected-frame timing and audio while starting again at frame 0. The original file and annotations stay intact. JSON downloads default to the video name, accept a custom filename, and show stale or missing export errors before downloading. See the [release notes](docs/releases/v3.7.0.md).

## 3.6.1

Fix automatic interpolation in older projects with overlapping deleted ranges. Replacement boxes and saved repair markers now agree across overlapping fragments; drawing or adjusting a boundary fills between replacement boxes without a separate command. Later deletions stay blocked, and Undo and original-box recovery are preserved.

## 3.6.0

Refill deleted sections by drawing two replacement boxes for the same track and class. Includes an explicit **Interpolate between frames** command (**Shift+K**), previews, and whole-action Undo/Redo. Existing boxes and hidden frames outside the selected section are kept. Repeated overlapping deletions now retain the latest range correctly. See the [release notes](docs/releases/v3.6.0.md).

## 3.5.0

Configurable box labels, source-pixel dimensions, optional first-box confirmation, consistent project class colors, and reliable editing of overlapping boxes. See the [release notes](docs/releases/v3.5.0.md).

## 3.4.2

Track numbers are scoped to each video across creation, editing, imports, and export validation. Existing IDs and annotations are preserved. See the [release notes](docs/releases/v3.4.2.md).

## 3.4.1

Long frame numbers, automatic first-box registration and distinct new-track colors, compact toolbar shortcuts, and removal of track merging. View mode and edit actions remain in the right-click menu. See the [release notes](docs/releases/v3.4.1.md).

Version 3.4.0 was withheld after clean-install CI detected a dependency constraint changed during the version bump. Version 3.4.1 restores the unchanged dependency lock.

## 3.3.0

- Optional stable track display colors; class colors remain the default.
- Visible keyframe diamonds, counts and previous/next navigation with [ / ].
- Preview and import single-video Frameinsight v2/v3 JSON, retaining class boxes, numeric IDs when free, keyframe provenance and deleted ranges. New import history is undoable; old validation/undo history is not restored.
- More discoverable track joining, box-replacement and class-copy guidance, and explicit empty-project messaging.
- Batch frame-ledger writes and hash while copying videos; exact decoded images and timestamps are unchanged. Preparation progress is visible while indexing.


## 3.2.1 — 2026-09-23

Compact shadcn workspace, editable project and class names, clearer canvas controls and box labels, and review in the editor followed by full-page structural validation and export. See the [release notes](docs/releases/v3.2.1.md).

The 3.2.0 candidate was withheld after CI found that a closing context menu could briefly block annotation shortcuts. Version 3.2.1 includes the correction.

## 3.1.0 — 2026-09-23

Project folders with multiple videos, a dark workspace with tracks on the right, consistent class ordering, and previewable YOLO/MOT imports. See the [release notes](docs/releases/v3.1.0.md).

## 3.0.1 — 2026-09-23

First public installer release. Every frame without a box now shows Hidden; context-menu undo acceptance waits for saved server state. See the [release notes](docs/releases/v3.0.1.md).

## 3.0.0 — 2026-09-23

See the [3.0.0 release notes](docs/releases/v3.0.0.md) for the canvas redesign, named classes, JSON v3, desktop installers, and opt-in updates.

Earlier development versions used fixed Visible/Extended box slots. Version 3 preserves those projects while allowing new classes without a fixed two-class limit.
