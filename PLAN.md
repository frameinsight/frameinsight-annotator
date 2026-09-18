# Frameinsight: GPU-Assisted Dual-Box Video Annotator

## Build specification for the coding agent

**Deliverable:** A working, local browser application, not only a prototype layout.  
**Primary user:** A human annotator working through CCTV video, usually one person at a time.  
**Priority:** Fast drawing, resizing, frame navigation, reliable saving, and correct exports.  
**AI role:** Propose boxes; never silently decide final identity or overwrite human work.

This specification combines the user's agreed `person_ext` / `person_visible` workflow with the supplied *Person Detection and Tracking Annotation Handbook*, version 1.0. Annotation policy is sourced from that handbook; architecture, shortcuts, interaction details, performance targets, and milestones below are proposed implementation requirements. The supplied *Training.pdf* is project context, not proof of this new tool's speed or accuracy. [H1, H2]

Do not turn this into an autonomous tracking project. The first release must remain useful when the detector misses every person or the GPU worker is stopped.

---

## 1. Product goal and scope

Build a desktop-first web editor that runs on the user's GPU-assisted machine and opens in a browser. The user should be able to select an existing suggestion or draw a missing box, resize directly, move to the next frame with **F**, and return with **D**. No toolbar-button selection should be required for routine drawing or resizing.

The user may assign a final numeric person ID at the start, during annotation, or after finishing a visible segment. Internally, use a permanent unique identity key so renaming a display ID never disconnects annotations.

### Required in the first usable release

Support local video import, exact frame stepping, two linked rectangles per person where supported, manual identity assignment, editable AI suggestions, hidden/outside intervals, undo/redo, autosave, saved-project reopening, completeness review, and export.

Support multiple projects and video files, but start with one active editor per project. Multi-user simultaneous editing, automatic global identities across cameras, training new models, segmentation painting, and a fully automatic long-term tracker are outside the first release.

**Success means fewer human actions without silently introducing incorrect labels.** A high count of generated boxes is not the success metric.

## 2. Main user workflow

1. Open a video. Index its frames and start optional YOLO proposal generation in a background worker. Editing must become available as soon as the requested frame can be decoded; do not wait for the full detector pass.
2. Press **N** to start a person with a temporary display name, such as `Draft 3`. The active geometry is A: `person_ext`.
3. Click a suitable AI suggestion to attach it to the active person, or drag to draw A manually.
4. For a genuinely clear person, press **E** to declare that A and B are equal. Otherwise draw or select B: `person_visible`. After initially drawing A while B is missing, automatically focus B.
5. Resize or reposition either rectangle directly. Save on pointer release. Normal editing must not trigger AI inference.
6. Press **F** to save the current draft locally and display the next frame. **D** goes back. The active person remains selected.
7. Press **Enter** instead of F to approve the current person's valid observation and advance. Ordinary navigation alone does not mean approval.
8. When the person becomes completely invisible, mark the first missing frame as the start of a gap. Navigate to the return. Resume only after an explicit human identity decision.
9. Finish the current segment and assign or rename the numeric person ID whenever convenient. All linked A/B observations follow that identity automatically.
10. After the person-by-person pass, perform a full-frame completeness pass to check for unlabelled people. Only then mark a frame complete for detector export.

### Example

`Person 17` is visible in frames 0–99, hidden in 100–179, and returns in 180–300. Keep boxes on the visible frames only. Store the gap separately. The return is a new visible segment; link it to Person 17 only when confirmed. A gap does not require changing the verified physical identity, and a new segment does not prove a new physical person. [H1: sections 10 and 12]

## 3. Annotation policy: implement this exactly

### One person record, two geometry fields

**A — `person_ext`:** The supported full extent of the person's current pose, including hidden body parts only where evidence supports the estimate.

**B — `person_visible`:** The smallest axis-aligned rectangle enclosing all visible evidence belonging to that person. This is not a segmentation mask: the rectangle may contain background or an obstruction between visible body parts.

A and B belong to one physical observation. They have the same person identity. They are not two counted people. [H1: sections 8 and 19]

| Situation | A: `person_ext` | B: `person_visible` | External occlusion |
|---|---|---|---|
| Whole person visible | Whole current body | Equal to A | Off |
| Head to waist visible, legs behind a counter | Supported whole-body estimate, otherwise unknown | Visible head-to-waist extent | On |
| Only one vertical side visible | Supported full extent, otherwise unknown | All visible parts on that side | On |
| Only head visible | Estimate only with defensible context; otherwise absent/unknown | Visible head | On when the body is externally blocked |
| Person fully hidden | No positive box | No positive box | Gap reason: occlusion |
| Person completely outside the image | No positive box | No positive box | Gap reason: outside |
| Person cut off by image border | Supported extent clipped to the image | Visible in-image evidence | Record truncation separately |

### Geometry requirements

Use original decoded-image coordinates, not browser display coordinates. Store floating-point `x1, y1, x2, y2`, with `0 <= x1 < x2 <= width` and the corresponding height constraints.

B must be **inside or equal to** A whenever A exists. It is not always strictly smaller. Show a containment warning while editing; never silently expand A or crop B to force a match. Save inconsistent edits as drafts, but prevent approval until they are resolved. Use a small documented floating-point tolerance, not a licence to hide annotation mistakes.

Do not force constant height. Boxes must follow crouching, bending, sitting, scale changes, and actual posture. Do not extend every head into a standing body. Neighbouring frames can supply evidence, but a fully invisible person does not receive a positive detection box. [H1: sections 7–9]

### Metadata

| Field | Values and behaviour |
|---|---|
| `person_id` | User-facing positive integer, scoped to project/session; equal for A and B. May remain unassigned while editing. |
| `identity_uuid` | Permanent internal identity key; never use the editable display ID as a database primary key. |
| `full_quality` | `observed`, `estimated`, or `unknown`; also allow `unset` while editing. Unknown means A is null and an explanation is retained. |
| `occluded` | True/false; allow unset until reviewed. Refers to external obstruction of the person, not whether B itself contains only visible evidence. |
| `truncated` | True/false; separate image-border condition. |
| `review_state` | `draft`, `needs_review`, or `approved`, separate from model provenance. |
| `origin` | Per geometry: `manual`, `model`, `copied`, or `interpolated`. Keep the original model proposal reference after human correction. |
| `evidence_note` | Required for unknown full extent; support frame-range references for estimates and identity decisions. |
| `geometry_link` | `independent` or `equal`; equal is set by an explicit clear-person action, not a detector assumption. |

Changing occlusion to On breaks an equal-geometry editing link, but must not automatically change either rectangle. A partial person can legitimately have B approximately equal to A when only separated extremities are visible.

While the explicit equal link is active, editing A updates both rectangles. Directly editing B breaks that link first and changes B only; show a brief notice and require visibility/full-quality review before approval. Do not silently keep both rectangles linked while the user tries to make B smaller.

Do not calculate a visibility percentage from `area(B)/area(A)`. Do not replace binary flags with invented fractions. Pair annotations with their saved identity/observation relationship, not an overlap heuristic. [H1: section 9]

## 4. Direct mouse interactions: no toolbar dependence

Implement these canvas rules before adding advanced AI.

| Pointer action | Required behaviour |
|---|---|
| Click an existing annotation border | Select that person and geometry immediately. |
| Drag an edge or corner | Resize immediately, including from hover; no separate resize mode. |
| Drag inside the active existing rectangle | Move that rectangle. |
| Drag when the active geometry is missing | Create that geometry, including when drawing B inside A. |
| Drag empty canvas with an active person | Create a missing active geometry; if it already exists, keep replacement explicit rather than unexpectedly adding duplicates. |
| Alt + drag | Explicitly draw/replace the active geometry, including within existing rectangles. |
| Click a detector proposal | Attach only the selected geometry to the active person; leave identity choice human-controlled. |
| Alt + click on overlapping proposals | Cycle hit candidates with a clear label; do not choose the largest box automatically. |
| Wheel over canvas | Zoom around the cursor. |
| Space + drag | Pan the image. |
| Release pointer | Commit one undoable edit and autosave; do not open a confirmation dialogue. |

### Prevent the nested-box interaction bug

When B is active and missing, dragging inside A must draw B, **not move A**. The active geometry determines hit-testing priority. Provide **1**, **2**, and **Tab** to switch between A and B when they overlap or are identical.

Resize handles should have a constant screen-space hit size as the image zooms. Do not require pixel-perfect border clicks. Use explicit geometry labels and different line styles as well as colours. Selected annotations should remain visible without covering the person's face/body with an opaque fill.

Disable rotation and accidental flipping. Convert Konva scale changes back into stored width/height at the end of a transform; do not repeatedly accumulate scale into coordinates. Konva documents its transform behaviour explicitly. [S1]

Separate the small screen-distance threshold used to distinguish a click from a drag from the validity of a small source-image person. Tiny valid boxes must remain possible after zooming.

If the user presses F or D during a drag, finish/commit the active edit to its original frame before navigating. Escape cancels the uncommitted drag. Never attach an in-progress edit to the newly displayed frame.

## 5. Keyboard shortcuts

These are defaults and must be remappable. Display the main shortcuts in a narrow footer and provide a searchable help overlay with `?`.

| Key | Action |
|---|---|
| **F** | Next exact source frame; save draft, do not auto-approve. |
| **D** | Previous exact source frame; save draft, do not auto-approve. |
| **Shift + F** | Forward 10 source frames. Intermediate frames remain unreviewed. |
| **Shift + D** | Back 10 source frames. |
| **1** | Select A: `person_ext` for drawing/editing. |
| **2** | Select B: `person_visible` for drawing/editing. |
| **Tab** | Switch A/B while canvas is focused. |
| **N** | Start a new temporary person identity and visible segment. |
| **I** | Edit the active person's numeric display ID. |
| **E** | Explicit clear-person action: set A=B using the available active box, mark full extent observed and external occlusion Off. Preserve truncation. |
| **O** | Toggle external occlusion for the active observation. |
| **R** | Set full extent estimated; allow switching observed/estimated through the metadata control. |
| **U** | Mark full extent unknown; clear A as an undoable action and retain B plus a reason. |
| **C** | Copy the previous frame's same-person pair as a current-frame draft; never copy across a recorded gap. |
| **Enter** | Approve the active person's valid observation and advance one frame. |
| **Shift + Enter** | Approve active observation and stay on this frame. |
| **Ctrl/Cmd + Enter** | Mark the whole frame reviewed-complete after the explicit completeness check. |
| **G** | Start a gap at the current first-invisible frame; choose the cause. |
| **H** | Resume at this currently visible frame; close the gap through the preceding frame and require a return-identity decision. |
| **T** | Finish the active visible segment; do not infer an exit from finishing annotation. |
| **Q** | Toggle optional click-link quick mode, once that mode is implemented. |
| **Delete** | Delete only the active geometry; keep the other geometry and mark the observation draft. |
| **Ctrl/Cmd + Z** | Undo the last annotation command, including identity edits and gaps. |
| **Ctrl/Cmd + Shift + Z** | Redo. |
| **Escape** | Cancel active gesture or close a popup; never discard saved annotations. |
| **Space** | Play/pause on a tap; pan when held during drag. |
| **0** | Fit image to the available canvas. |
| **?** | Shortcut help. |

Shortcuts must be ignored while typing in a text/number field, using an input method, or interacting with a dialogue that owns the key. Unmodified F/D must not trigger browser search or accidental form actions. Destructive and identity-changing keys must not repeat when held. Normal frame stepping may repeat at a controlled rate, but must not skip source indices silently.

**E is explicit human confirmation of equal geometry, not AI inference.** If both boxes are already different, show a visible non-modal notice of which box becomes authoritative and make the whole change one undo action. If neither box exists, E does nothing except show a brief hint.

## 6. Screen layout

```text
+-----------------------------------------------------------------------+
| Project / Video | Frame 121 of 1800 | 00:04.000 | Saved | GPU: Processing |
+---------------+-----------------------------------------+-------------+
| PEOPLE        |                                         | ACTIVE      |
| Person 1      |           LARGE VIDEO CANVAS            | Person 17   |
| Person 2      |                                         | A / B       |
| > Person 17   |       A: solid line / label A            | Occlusion   |
| Draft 3       |       B: dashed line / label B           | Full quality|
|               |                                         | Truncation  |
+---------------+-----------------------------------------+-------------+
| Timeline: approved / draft / unreviewed / gap / issue                    |
| Nearby-frame thumbnails | A row + B row under the active person         |
+-----------------------------------------------------------------------+
| F next | D back | 1 A | 2 B | E equal | Enter approve+next | ? help        |
+-----------------------------------------------------------------------+
```

Keep the video dominant. Panels must collapse and resize; support ordinary laptop and full-HD desktop screens. Tablet layout may stack panels, but do not compromise the mouse/keyboard desktop editor to promise a phone-first product.

The person list shows unique identities, not the number of rectangles. Selecting a person keeps it active as the user moves through frames. Provide a small optional strip of nearby frames to inspect an occlusion without replacing the main frame.

Show review state independently of save state. `Saved` means the server acknowledged persistence, not that the annotation is correct. Use `Saving`, `Saved locally`, `Saved`, and `Save failed` states accurately.

## 7. Application architecture

Use this proposed stack unless the existing repository already has an equivalent well-tested foundation. Do not rewrite a working editor merely to match library names.

| Layer | Proposed implementation |
|---|---|
| Browser interface | React + TypeScript + Vite. |
| Canvas editor | Konva / react-konva, with direct transform handlers. |
| Client annotation state | A small typed store, for example Zustand, plus a command-based undo manager. |
| API server | Python FastAPI + Pydantic models. |
| Video decoding | PyAV/FFmpeg, with indexed frame access and a disk-backed cache. |
| AI worker | Separate persistent Python process using PyTorch CUDA and a configurable YOLO adapter. |
| Project storage | SQLite on local disk, short transactions and a serialized writer. |
| Large assets | Filesystem: originals, frame cache, model weights, exports, backups. |
| Progress updates | WebSocket events; authoritative job state also available through normal HTTP. |
| Tests | Python unit/integration tests, TypeScript interaction tests, and Playwright browser tests. |

An API is the interface between browser and server. The worker is a separate process that handles expensive model computation. A cache stores reusable results to avoid calculating them again.

```text
Browser: draw / resize / keyboard / local undo
                   |
          FastAPI: validate and save
             /                 \
SQLite + files             job queue
                                |
                    persistent GPU worker
                                |
                     cached box proposals
```

Do not run inference in pointer handlers or block the API request loop with video processing. FastAPI's guidance distinguishes small background tasks from heavy computation; a dedicated worker is the design here. [S3]

Keep browser editing independent of the GPU. More GPU memory does not fix a canvas that rerenders the whole project on each mouse movement.

## 8. GPU and detector integration

First inspect the actual operating system, GPU model, available GPU memory, driver, Python and PyTorch compatibility. Provide a diagnostics command and pin the package versions tested on that machine. Do not assume a specific CUDA installation or a fixed amount of GPU memory.

Use the user's existing trusted YOLO weights when provided. Do not silently download a replacement model or change the project classes. The adapter must inspect and validate the model's class-name mapping.

### Proposal generation

Decode indexed frames, run inference in bounded batches, and save results under their exact `video_id` and `frame_index`. Ultralytics supports video/image prediction, configurable devices and streaming/batched operation. [S4]

Keep one model instance resident in a dedicated worker. Avoid loading the same model into every web-server process. With CUDA multiprocessing, use an appropriate `spawn`-based worker lifecycle rather than forking a process after CUDA has been initialized. [S5]

For the first video pass, process every intended frame without silent stride-based skipping. Keep an explicit input-frame ledger when batching; verify each output is assigned to the correct source frame. Reuse the proposals while labeling different people in the same video.

Cache keys must include the source hash, selected video stream, model hash, inference settings, class mapping, and relevant adapter version. Changing a confidence slider cannot recover proposals discarded by an earlier higher inference threshold; either filter the saved candidate set or deliberately schedule a new versioned pass.

A one-class person detector proposes A only under a confirmed full-box project mapping. It does not establish B or establish that A is correct. A two-class detector may propose both geometries, but pairing remains a suggestion until human acceptance. Never label a frame clear solely because a detector is confident.

Keep cross-class A/B proposals separate. For a model pipeline that applies overlap suppression, do not suppress one geometry class using the other. Respect the actual model's output format; do not assume every YOLO version has identical postprocessing.

### Worker behaviour

Use a bounded queue and give the currently requested frame priority at a safe batch boundary. Provide progress, cancel, restart, and recoverable error messages. On memory exhaustion, retry with a smaller batch within a bounded retry policy; record the change. Do not silently change model resolution or silently fall back to CPU while displaying GPU status.

A worker crash must leave manual editing and existing proposals available. Results arriving late must be added to the suggestion store, never written over a user-edited observation.

No automatic identity matching or detector retraining is required for this stage. Optional short-range tracking or a visible-mask model can be added later behind the same proposal interface.

## 9. Exact frames, caching, and display coordinates

### Preserve original timing

On ingestion, preserve the original video. Save a source hash, dimensions, video-stream index, frame count determined from the index, nominal frame rate, presentation timestamps, and decoder/version information.

A presentation timestamp identifies when a decoded frame should be shown. Store the integer timestamp and its time-base units, plus derived seconds when available. Do not replace variable-rate timing with `frame_index / nominal_fps`. PyAV documents both time-base semantics and seeking to a nearby keyframe rather than an arbitrary exact frame. [S6, S7]

Assign internal frame indices from zero in decoded presentation order. A seek must decode forward from the appropriate point and match the frame ledger. Where repeated or missing timestamps prevent reliable random access, use the verified sequential cache/index rather than pretending a timestamp uniquely identifies a frame.

Use exact decoded still frames for annotation. Browser video playback can be a navigation preview, but a paused preview timestamp alone must not select the authoritative annotation frame. If a proxy is generated, retain its mapping to the original frames and never train from it accidentally.

### Cache policy

Build a compressed frame cache on disk, progressively where needed. Keep a bounded memory cache around the active frame and prefetch a small forward/backward window. Make the window and memory cap configurable. Do not hold all raw frames or all canvas nodes for a video in browser RAM.

An in-flight frame response must carry a frame key/request token. Ignore stale responses for display. Swap the image and its matching overlay together; never show frame 121 with frame 120's boxes. When an exact frame is unavailable, show a loading/error state and do not accept annotation against the previous image under a new frame number.

### Coordinate conversion

Keep one tested transform between source pixels and canvas pixels. Account for panel resizing, fit-to-view, zoom, pan, device pixel ratio, and any display rotation. Persist source-image coordinates only. If the detector library has already returned original-image coordinates, do not undo its letterbox transform a second time.

Clamp creation/resizing at image boundaries explicitly. Disable invalid negative-area boxes. For existing valid annotations, never bulk-rescale or shift geometry merely because the browser layout changed.

## 10. Persistence and data model

Store one observation containing both A and B, rather than maintaining two independent annotation collections that can lose their relationship.

Suggested entities:

```text
projects       policy, schema version, workspace configuration
videos         source, camera/session, hash, frame ledger reference
frames         index, timestamp, decode state, completeness review
identities     internal UUID, optional numeric person_id, scope
segments       video, local observable segment, identity link status
observations   frame, segment, identity, A, B, quality, revision
identity_links same / different / unresolved, evidence and review
intervals      gaps, outside events, unavailable footage, unknown cause
proposals      model output and provenance; separate from observations
operations     undoable edits, IDs, timestamps, revision history
jobs           queued / running / completed / failed / cancelled
exports        snapshot version, settings, exclusions, output references
```

Example observation; values are illustrative:

```json
{
  "observation_id": "obs-example-120",
  "video_id": "cam01_session07_clip01",
  "frame_index": 120,
  "identity_uuid": "identity-example-17",
  "person_id": 17,
  "segment_id": "segment-example-17a",
  "person_ext": [800.0, 200.0, 960.0, 680.0],
  "person_visible": [815.0, 200.0, 945.0, 390.0],
  "full_quality": "estimated",
  "occluded": true,
  "truncated": false,
  "geometry_link": "independent",
  "review_state": "approved",
  "provenance": {
    "person_ext": {"origin": "model", "human_corrected": true},
    "person_visible": {"origin": "manual", "human_corrected": false}
  },
  "evidence_note": "Pose and scale checked in nearby frames",
  "revision": 4
}
```

A visible observation with unknown full extent keeps `person_visible`, sets `person_ext` to null, and stores `full_quality: unknown`. This is not a person-disappearance event. Fully invisible intervals do not create positive observation boxes. [H1: sections 9, 19]

Prevent two simultaneous observations with one verified identity in the same video/frame. Identical numeric IDs in unrelated sessions must not be merged automatically. A provisional return may have its own internal identity while the relation to a prior identity remains unresolved; do not automatically use unresolved pairs as different-person training examples.

### Autosave and revision safety

Each pointer-release edit becomes one command containing the original video/frame key, affected observation, old/new values, unique operation ID, and base revision. Persist pending commands to browser storage, then send them to the server. Server application must be idempotent: a retried operation must not apply twice.

Use short serialized database transactions and revision checks. Show a conflict rather than silently overwriting a newer edit. Autosave must handle rapid F/D navigation without waiting for network acknowledgment, while clearly distinguishing local-only from server-confirmed saving.

On refresh, restore pending local commands and reconcile them. Keep undo/redo as persisted compensating commands; do not delete history to implement undo. Any change to approved geometry or identity downgrades the affected approval/completeness state until reviewed again.

Back up the database through a consistent snapshot mechanism. Include all relevant state rather than copying an open database file carelessly. Do not store original videos or large binary images inside annotation rows.

## 11. Human identity linking, gaps, and optional assistance

Creating a new person uses a permanent internal identity immediately; entering the numeric ID later simply changes its display mapping. Relabeling both geometry tracks should be automatic because they share one identity record.

Provide explicit segment split, link, unlink, and identity merge operations with undo. Before merging, check for contradictions, especially two different observations with the same proposed identity in one frame. Offer same/different/unresolved, and store evidence for difficult returns. Finishing a segment must not assert that the person left the scene.

Gap boundaries use inclusive source-frame indices. G begins at the first missing frame. H resumes at the first visible return frame, so the gap ends one frame before H. Open gaps at clip end remain open-ended within that clip. No AI pass may fill them with positive boxes without explicit human review changing the interval itself.

### Assistance after the manual editor is reliable

Previous-frame boxes may be displayed as faint ghosts, not accepted labels. C can copy a same-person pair from the immediately preceding frame as drafts. Interpolation between manually reviewed frames may produce draft suggestions only inside one visible segment. It must not bridge a gap, replace approved work, or mark skipped frames reviewed.

Optional **Quick Link mode** allows clicking a complete, valid proposal pair to explicitly accept it for the active person and advance. A single A proposal cannot trigger this when B or required metadata is missing. The mode must display that the click means approve-and-next; ordinary editing mode retains normal selection behaviour. Undo after auto-advance must return to the affected frame and reverse the acceptance.

A future tracker can rank likely proposals, but the user remains responsible for identity. IoM (overlap divided by smaller-box area) may highlight containment candidates; it must not pair master annotations or certify that two overlapping people are the same.

## 12. Review states and frame completeness

Keep three separate concepts: a detector proposed something; a human edited it; a human approved it. Also separate approval of one person's pair from completeness of the whole frame.

The default person-by-person workflow leaves a frame incomplete until the user checks the entire image. The completeness action must show unresolved/missing pairs and any remaining proposals for consideration, but rejecting all detector proposals is not proof that no other person exists.

A reviewed frame can be populated, genuinely empty, or contain explicit uncertainty. Unknown full extent can be a valid native annotation; it may still block particular training exports. Keep those meanings separate.

Provide an issue list for missing B, unknown A, containment failures, duplicate identity assignments, unreviewed generated boxes, unsupported identity links, and undecodable frames. Give keyboard navigation to the next issue through the help/command palette without forcing extra toolbar steps.

## 13. Exports and CVAT compatibility

### 13.1 Native project archive: authoritative copy

Export a versioned project archive containing metadata, frame mapping, identities, observations, segments, intervals, links, provenance, review state, and the export policy. JSONL means one JSON record per line and is suitable for portable copies. Keep the database as the working store and the versioned archive as a portable snapshot.

Original videos can be included on request or referenced through a manifest with hashes. A missing source must be reported, not replaced with another similarly named video.

### 13.2 CVAT for video XML

Provide two geometry tracks per verified person per video where those geometries exist: `person_ext` and `person_visible`. Their CVAT track IDs are distinct; both carry the same numeric `person_id` attribute. Do not count these as two people.

Export `person_id` as a fixed attribute. Export changing quality/truncation metadata as mutable attributes. Put `full_quality` on the visible track so `unknown` survives when the full geometry is unavailable. Preserve project occlusion values consistently, and include a stable internal identity/pair reference where supported.

Use outside markers to prevent CVAT from interpolating through unavailable geometry or actual invisible intervals. `outside` on the full-geometry track because A is unknown does not mean the physical person left the frame: B and the master metadata preserve that distinction. Prefer explicit per-frame keyframes in the first exporter for verified observations, with properly terminated spans. Marker geometry is format bookkeeping, never a positive detection.

CVAT video XML supports tracks, per-frame geometry, outside/occluded flags, and custom attributes. Not every rich project relation is expressible in XML, so always include the native sidecar for gaps, unresolved links and review history. [S8]

Implement CVAT native import as well. Preserve source fields, IDs and coordinate conventions; require review where imported A/B pairing is missing or ambiguous. Never infer the numeric person's identity from a CVAT geometry-track ID alone. Round-trip a real small export through the target CVAT version before declaring compatibility.

### 13.3 YOLO detector datasets

Provide explicit export profiles, without silently changing the user's two-class plan:

| Profile | Targets |
|---|---|
| `dual_class` — the user's experiment | Class 0 `person_ext`, class 1 `person_visible`; retain linked-pair sidecar. |
| `full_only` — conventional full-person comparison | Supported A only; one class with a documented name mapping. |
| `visible_only` — separately defined experiment | B only; one class with a documented name mapping. |

YOLO text stores class and normalized centre/width/height coordinates, not the master identity relationship. Export `dataset.yaml`, images, labels, frame mappings, pair mappings, settings, and exclusion reports. Never export both A and B as class 0 in a single conventional person dataset. [S9]

**The exporter does not make ordinary YOLO a paired-output model.** The dual-class profile preserves the requested experimental data; model training and pair-aware assignment are separate work. Do not deduplicate equal A/B geometry across the two different geometry classes, and do not automatically promise reliable two-box predictions.

Only export reviewed-complete frames whose target treatment is resolved. For `full_only` and `dual_class`, a known visible person with unknown A blocks that image by default until an engineer supplies an implemented alternative policy. Do not delete only that person's row and keep the image as ordinary training data. A custom `ignore` attribute alone does not implement ignored training loss. [H1: section 9.4]

For all profiles, B-missing/incomplete observations must be resolved as required by the selected task. Fully hidden people contribute no positive targets, but other reviewed visible people in the same frame remain eligible. Export reviewed empty frames with explicit empty labels for auditing.

Keep whole related recordings/incidents and synchronized views grouped when assigning train/validation/test. Do not randomly distribute neighbouring frames across splits. [H1: section 15]

### 13.4 MOT tracking evaluation

MOT is a derived tracking view, not the only master. Export one declared geometry per physical identity, never both A and B as separate pedestrians. Default full-box evaluation uses A and saves B/quality/intervals in a sidecar.

CVAT's MOT export documents box tracks and the special visibility/ignored attributes; it is not a container for all custom dual-box metadata. [S10]

Explicitly select and document the target evaluator's frame numbering, coordinate origin, class mapping and visibility convention. Verify an existing known-good sample. Never invent visibility fractions from binary occlusion, and never silently use zero as “0% visible” for the project's legacy encoding.

Preserve continuous frame order and timing. Unknown A or unresolved identity requires a documented evaluator treatment; do not silently drop frames, compress time, invent identity links, or present a guessed MOT file as valid evaluation truth. Return an actionable export issue until the evaluation profile is resolved. The native archive remains exportable with the uncertainty intact.

### 13.5 ReID crop export

A later module may generate source-image crops from A and/or B with identity, camera/session, source frame, geometry type and quality metadata. ReID means appearance matching between observations. Require reviewed identity relationships and record crop contamination/quality exclusions. Unknown cross-gap relations must not become automatic different-person pairs.

Do not train models inside the labeling application in this release.

## 14. Suggested API and repository structure

These paths are proposed app contracts, not existing third-party APIs.

```text
POST   /api/projects
POST   /api/projects/{project_id}/videos
GET    /api/videos/{video_id}/metadata
GET    /api/videos/{video_id}/frames/{frame_index}
GET    /api/videos/{video_id}/annotations?start=...&end=...
GET    /api/videos/{video_id}/proposals?start=...&end=...
POST   /api/projects/{project_id}/operations
POST   /api/videos/{video_id}/proposal-jobs
GET    /api/jobs/{job_id}
POST   /api/jobs/{job_id}/cancel
POST   /api/projects/{project_id}/imports/cvat
POST   /api/projects/{project_id}/exports
GET    /api/exports/{export_id}
GET    /api/system/diagnostics
WS     /api/projects/{project_id}/events
```

The operations endpoint handles typed, validated annotation commands with unique operation IDs and expected revisions. Upload, indexing, proposal and export requests return job IDs rather than holding a request open for an entire video. WebSocket messages carry project/video/frame/job keys and sequence numbers; reconnecting clients fetch authoritative state.

```text
frameinsight-annotator/
  frontend/src/
    editor/          canvas, pointer state machine, coordinate transforms
    commands/        shortcuts, undo/redo, operation definitions
    state/           observations, proposals, pending saves
    panels/          people, metadata, issues, timeline
    api/             typed client and events
  backend/app/
    api/             HTTP and WebSocket routes
    schemas/         validated project and operation schemas
    services/        annotation, identity, gap, review services
    video/           decoding, indexing, cache, frame mapping
    workers/         GPU worker and proposal adapters
    storage/         database, migrations, snapshots
    formats/         native, CVAT, YOLO, MOT
  tests/
    unit/
    integration/
    browser/
    fixtures/
  docs/
    SETUP.md
    ANNOTATION_POLICY.md
    SHORTCUTS.md
    EXPORTS.md
    ACCEPTANCE_RESULTS.md
  config.example.yaml
```

Keep large videos, caches, exports and model weights outside the source repository. Never commit user footage or credentials.

## 15. Performance, reliability, and security

### Proposed performance targets, not claimed benchmark results

Measure on the user's actual machine and record hardware, browser, image dimensions, number of visible boxes, and whether GPU preprocessing is active.

| Operation | Initial target |
|---|---|
| Local drag/resize rendering | Approximately 60 Hz on a normal desktop display; 95% of input-to-visible updates within 50 ms. |
| F/D to a prefetched exact frame | 95% within 100 ms, including matching overlay display. |
| Server acknowledgment of a small local edit | Normally within 500 ms on a healthy local machine; never block drawing for it. |
| GPU worker stopped/crashed | Manual draw/resize/navigation continue on available decoded frames. |
| Rapid navigation and reload | No acknowledged edit loss, no wrong-frame writes. |

A 95% target describes the latency achieved by 95 out of 100 measured operations. Cold video seeks, first model loading and cache misses must be reported separately, not hidden inside warm-cache claims.

Use a small number of canvas layers: image, ordinary overlays, and active interaction. Redraw only what changes and disable hit-testing on non-interactive layers. Do not rerender the whole timeline or entire project on pointer movement. These follow Konva's performance guidance. [S2]

Default to local-only access. No uploads to cloud services or telemetry containing footage. For access from another device, require an explicit network configuration with authentication and restricted origins. Validate file paths against the configured workspace; safely handle archives, XML parsing and uploaded filenames. Load model weights only from trusted approved locations. Check third-party software/model licence requirements before redistribution; do not bundle model weights blindly.

## 16. Implementation milestones

### Milestone 1 — Manual editor and exact frames

Build import/indexing, frame display, F/D stepping, canvas draw/move/resize, A/B switching, temporary identities, E equal-box action, autosave, undo/redo, reopening and native export. No AI dependency.

**Gate:** A short clip can be fully annotated and reopened correctly with the GPU worker disabled.

### Milestone 2 — Correct difficult cases

Add unknown A, occlusion/truncation, gap intervals, return decisions, segment split/link, frame completeness and export validation. Implement nested/equal-box selection correctly.

**Gate:** Full-to-half, head-only, invisible gaps and identity-confusion fixtures preserve the agreed policy without fabricated targets.

### Milestone 3 — GPU proposal assistance

Integrate the user's YOLO model, cached proposals, bounded background jobs, progress/cancel/restart, safe suggestion acceptance, previous-frame ghosts and optional Quick Link mode.

**Gate:** AI completes or fails while the user edits, without changing approved labels or blocking interactions.

### Milestone 4 — Interchange and dataset exports

Complete CVAT import/export, the explicit YOLO profiles, and the verified MOT profile plus sidecars. Produce exclusion and round-trip reports.

**Gate:** Reopened exports preserve intended frame indices, boxes, class mappings, A/B links, IDs and uncertainty policy.

### Milestone 5 — Performance and usability

Test on the user's real 60-second clip and record annotation time, keyboard/mouse actions, remaining errors, memory and warm/cold navigation latency. Compare the same human workflow and annotation quality with CVAT; do not invent a speedup percentage.

**Gate:** Provide actual measurements and a list of any unmet targets. Optional interpolation or short-range tracking comes after this gate, not before the core editor is usable.

## 17. Acceptance tests the agent must run

| Test | Required result |
|---|---|
| Draw A, then draw B inside A without toolbar clicks | Correct two geometries, one person. |
| A and B have equal coordinates | Both remain selectable and exportable; counted as one person. |
| Resize with cursor after zoom, pan and panel resize | Stored source coordinates remain correct. |
| B protrudes outside A | Draft saved with warning; approval blocked; no automatic geometry rewrite. |
| YOLO misses the person | User draws boxes and proceeds normally. |
| Only the head is visible and full posture unknown | B retained, A null, export issue handled explicitly. |
| User presses F immediately after a drag | Edit belongs to the old frame; next image and overlay match. |
| Frame responses arrive out of order | Stale image/overlay response cannot replace the current frame. |
| Gap starts 100, return at 180 | No positive boxes in frames 100–179. |
| A temporarily unknown while B remains visible | Person is not falsely marked outside/fully invisible. |
| New numeric ID assigned after 100 observations | All linked A/B observations follow the identity; no duplicated person. |
| Same numeric ID requested for conflicting identities | Resolve conflict explicitly; never silently merge. |
| Late GPU proposal after human resize | Proposal is retained separately; manual geometry unchanged. |
| Crash/reload with queued and acknowledged saves | Recover queued operations; no duplicate application or lost acknowledged edits. |
| Undo gap, merge, resize, or Quick Link | Correct geometry, frame, identity and review state restored. |
| F/D while typing a person ID | Text field works; no unintended navigation. |
| Non-integer/variable frame-rate video | F/D advances source frames and preserves actual timestamps. |
| Only one person labelled in a frame containing several | Frame remains incomplete; detector export is blocked. |
| CVAT export and reimport | Correct two track labels, same person_id, metadata and gap boundaries. |
| YOLO dual-class export | Classes remain distinct; pair sidecar retained; unknown-full policy enforced. |
| MOT export | One declared box per identity, continuous timing, verified numbering and visibility profile. |
| GPU worker unavailable | Existing projects remain manually usable with truthful status. |

Use generated video fixtures with burned-in source-frame numbers to test frame accuracy, plus representative real user footage when available. Unit-test coordinate transforms and export normalisation numerically. Browser tests must exercise real pointer gestures rather than only modifying the store directly.

For rounding/conversion tests, set a documented numerical tolerance appropriate to serialized precision. A numerical round-trip tolerance is different from annotator agreement about where a body ends.

## 18. Delivery checklist and first task

Deliver runnable source, pinned tested dependencies, local setup/start/stop instructions, a GPU diagnostics command, database migrations, example configuration without secrets, import/export documentation, a shortcut reference, and automated tests. Include real acceptance results and any known limitations. Do not report placeholder models, mocked inference or untested exporters as working integrations.

**Start with this vertical slice:** import video → show exact frame → N → draw A → E or draw B → resize directly → F/D → assign ID → autosave → reload → native export. Prove it works smoothly before adding a GPU model.

The final product must follow this principle:

> Human decides identity and approves evidence. AI supplies replaceable suggestions. Drawing and navigation never wait for AI.

---

## Source notes for implementation

These sources support annotation and library behaviours; they do not establish performance of the proposed app. Consult the installed versions' official documentation before coding exact APIs.

**H1.** User-supplied `Annotation_Handbook.pdf`, *Person Detection and Tracking Annotation Handbook*, version 1.0. Particularly sections 8–10 (geometry, uncertainty and identity), 15 (splits), 16 (training), 19–21 (master data, exports, existing CVAT work).

**H2.** User-supplied `Training.pdf`, development benchmark. It describes existing detector experiments, not this editor.

**S1.** Konva React Transformer documentation: direct selection/drag/resize and conversion of node scale into stored dimensions.  
`https://konvajs.org/docs/react/Transformer.html`

**S2.** Konva performance guidance: limited layers/redraws, selective event listening and dragging costs.  
`https://konvajs.org/docs/performance/All_Performance_Tips.html`

**S3.** FastAPI Background Tasks, especially the heavy-computation caveat.  
`https://fastapi.tiangolo.com/tutorial/background-tasks/`

**S4.** Ultralytics model prediction documentation: sources, batches, device selection and memory-aware streaming.  
`https://docs.ultralytics.com/modes/predict`

**S5.** PyTorch multiprocessing documentation: CUDA subprocess lifecycle. The cited main documentation may differ from an installed release; verify the installed version.  
`https://docs.pytorch.org/docs/main/notes/multiprocessing.html`

**S6.** PyAV container/seek documentation: seek to a nearby keyframe, then decode to the target.  
`https://pyav.org/docs/stable/api/container.html`

**S7.** PyAV timing documentation: presentation timestamps and time bases.  
`https://pyav.org/docs/stable/api/time.html`

**S8.** CVAT native format, video tracks and mutable/custom attributes.  
`https://docs.cvat.ai/docs/dataset_management/formats/format-cvat/`

**S9.** Ultralytics detection datasets: normalized class/box targets.  
`https://docs.ultralytics.com/datasets/detect/`

**S10.** CVAT MOT format: track rows and supported export attributes.  
`https://docs.cvat.ai/docs/dataset_management/formats/format-mot/`


[**Download the full coding-agent build plan**](sandbox:/mnt/data/Frameinsight_Coding_Agent_Plan.md)

The document contains the architecture, mouse behaviour, keyboard shortcuts, data structure, GPU processing, exports, build stages, and acceptance tests.

## 1. What the agent should build

Build a **human-controlled video annotation editor** that runs locally on your GPU machine.

**AI suggests boxes. You choose the person, correct the boxes, and approve the labels.** The editor must work even when YOLO detects nothing.

Your normal workflow should be:

```text
Open video → select a person
                ↓
Click a suggested box OR draw your own
                ↓
Draw/check the full and visible boxes
                ↓
Resize directly with the mouse
                ↓
F → next frame
D → previous frame
                ↓
Finish the segment → assign Person ID 17
```

Both boxes and all selected frames remain linked to the same person.

## 2. Mouse controls: no repeated toolbar clicks

The agent should implement this interaction:

| Action                                | What happens                              |
| ------------------------------------- | ----------------------------------------- |
| Drag when the selected box is missing | Draw that box                             |
| Drag a box edge or corner             | Resize immediately                        |
| Drag inside the active box            | Move it                                   |
| Click a suggested box                 | Assign that geometry to the active person |
| Scroll over the image                 | Zoom around the cursor                    |
| Hold Space and drag                   | Move the image around                     |
| Release the mouse                     | Save the edit automatically               |

**Important example:** After drawing the outer A box, drawing inside it must create the inner B box—not accidentally move A.

When A and B overlap or are identical, pressing **1**, **2**, or **Tab** must make either box easy to select.

For implementation, use **Konva—a browser drawing library—with React**. Its official examples support direct selection, dragging, and resizing. The agent must correctly convert resize transformations into stored box dimensions. ([Konva.js][1])

## 3. Keyboard shortcuts

These should be the defaults, with an option to change them later.

| Key                  | Action                                              |
| -------------------- | --------------------------------------------------- |
| **F**                | Next frame; save current draft                      |
| **D**                | Previous frame                                      |
| **Shift + F / D**    | Forward/backward 10 frames                          |
| **1**                | Draw or edit A: `person_ext`                        |
| **2**                | Draw or edit B: `person_visible`                    |
| **Tab**              | Switch between A and B                              |
| **N**                | Start a new person                                  |
| **I**                | Assign or change their numeric person ID            |
| **E**                | Declare the person clear: make A and B equal        |
| **O**                | Toggle occlusion                                    |
| **R**                | Mark the full box as estimated                      |
| **U**                | Mark full extent unknown; keep B, remove A          |
| **C**                | Copy the previous frame’s pair as an editable draft |
| **Enter**            | Approve the current person’s boxes and advance      |
| **Shift + Enter**    | Approve without advancing                           |
| **G**                | Start a hidden/outside gap                          |
| **H**                | Resume when the person returns                      |
| **T**                | Finish the current segment                          |
| **Delete**           | Remove the selected box only                        |
| **Ctrl + Z**         | Undo                                                |
| **Ctrl + Shift + Z** | Redo                                                |
| **Space**            | Play/pause; hold while dragging to pan              |
| **0**                | Fit the image to the screen                         |
| **?**                | Show shortcut help                                  |

**F means “move forward,” not “these labels are correct.”** Enter provides the faster approve-and-next workflow.

Single-letter shortcuts must stop operating while you are typing an ID or a note.

## 4. Your two-box annotation rules

The editor should store **one person observation containing two boxes**, not two unrelated people.

| Field                | Meaning                                       |
| -------------------- | --------------------------------------------- |
| `person_ext` — A     | Supported full-person extent                  |
| `person_visible` — B | Rectangle around the visible body parts       |
| `person_id`          | Same numeric identity for both                |
| `full_quality`       | Observed, estimated, or unknown               |
| `occluded`           | Whether another object/person blocks the body |
| `truncated`          | Whether the image border cuts off the body    |

**Fully visible:** A and B can be identical.
**Partly hidden:** B stays inside A, where A can be supported.
**Only a head with unknown body posture:** keep B and mark A unknown.
**Completely invisible:** save a gap, not invented boxes. These rules follow your handbook.  

### Important editing behaviour

Pressing **E** should create an explicit equal-box link:

```text
Clear person:
Draw A → press E → B becomes equal to A
```

While linked, adjusting A updates both. When you deliberately edit B separately, the editor breaks that link so you can make B smaller.

If B extends outside A, show a warning. **Do not silently enlarge A or cut B down.** Allow saving the unfinished draft, but require correction before approval.

## 5. How the agent should use your GPU

**Run YOLO separately from the interface.** Precompute and save suggestions so labeling Person 2 does not rerun the whole video after you finish Person 1.

```text
Video frames
     ↓
GPU worker runs your YOLO
     ↓
Suggestions saved by frame number
     ↓
Editor displays suggestions immediately when available
     ↓
You accept, resize, replace, or ignore them
```

Ultralytics supports configurable prediction devices, batching, and memory-efficient streaming. Use your existing trusted weights rather than silently replacing the model. ([Ultralytics Docs][2])

The implementation must follow these requirements:

* **Never wait for inference to draw, resize, or save.**
* Never overwrite a human correction when a late AI result arrives.
* Never require a detection before allowing a manually drawn box.
* Show accurate GPU progress and errors; manual editing must remain available.

A **worker** is a separate process doing expensive computation. Keep it separate from the Python web server; FastAPI’s documentation distinguishes heavy computation from small background tasks. ([FastAPI][3])

**A normal one-class detector will not magically provide B.** Initially, use its box as an editable A suggestion, then draw B or press E when the person is genuinely clear.

## 6. Recommended technical structure

| Component         | Proposed technology and purpose                                  |
| ----------------- | ---------------------------------------------------------------- |
| Browser interface | **React + TypeScript:** screens, controls, and application state |
| Drawing area      | **Konva:** rectangles, selection, moving, resizing               |
| Python server     | **FastAPI:** communication, validation, and saving               |
| Video reader      | **PyAV/FFmpeg:** decoding and exact frame access                 |
| GPU worker        | **PyTorch + your YOLO:** suggestions                             |
| Local database    | **SQLite:** people, boxes, gaps, and edit history                |
| File storage      | Original videos, cached frames, models, and exports              |

### Exact frames are essential

The editor must not accidentally show one frame while saving boxes against another.

Maintain an indexed record of the decoded frames and their timestamps. PyAV seeking lands near a requested timestamp, commonly at a keyframe; the application must then decode to the intended frame. Simply seeking a browser video to an approximate time is not enough for the annotation record. ([PyAV][4])

**Cache** means storing something for reuse. Cache nearby frames so F/D navigation does not repeatedly decode the video from the beginning.

## 7. Saving, identities, and disappearance

Use a permanent internal identity and a separately editable display number.

```text
Permanent internal identity
         ↓
Display number: Person 17
         ↓
All A/B boxes and verified segments
```

Changing `17` to `25` should update the identity display everywhere without disconnecting either box track.

Autosave after each completed edit. Show the difference between:

```text
Saved locally → Saved to server
```

Keep undo history, recover pending edits after reopening, and ensure an edit made on frame 120 cannot be saved onto frame 121 after pressing F.

For disappearance:

```text
Frames 0–99:    Boxes for Person 17
Frames 100–179: Hidden gap; no boxes
Frame 180:     You confirm the returning person
Frames 180+:   Continue the verified identity
```

An uncertain return should remain unresolved rather than becoming a guessed match. 

## 8. Required exports

| Export                        | What it contains                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| **Native project archive**    | Everything: A/B links, identities, gaps, quality, review history                              |
| **CVAT video XML**            | Separate A/B geometry tracks sharing `person_id`, plus supported attributes                   |
| **YOLO two-class experiment** | Class 0: `person_ext`; class 1: `person_visible`; separate file preserving pair relationships |
| **YOLO comparison exports**   | Optional full-only and visible-only datasets                                                  |
| **MOT tracking evaluation**   | One declared geometry per person ID, with extra metadata saved separately                     |

CVAT video XML supports tracks and custom attributes; its MOT export supports a much narrower set of attributes. Therefore, **MOT must not be the only saved copy**. ([CVAT Documentation][5])

The two-class YOLO export preserves your experiment, but ordinary YOLO text contains class and box coordinates—not a built-in relationship between A and B. Save that relationship separately. ([Ultralytics Docs][6])

**Also:** labeling one person does not make the whole frame ready for detector training. Add a final full-frame check for other people before export. Your handbook requires known visible people to remain represented, including cases needing uncertainty treatment.  

## 9. Build order for the agent

| Stage                  | Deliverable                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| **1. Manual editor**   | Exact frames, draw/resize, A/B selection, F/D, IDs, autosave, undo |
| **2. Difficult cases** | Occlusion, unknown full extent, gaps, returns, completeness        |
| **3. GPU assistance**  | Cached YOLO suggestions without blocking editing                   |
| **4. Exports**         | Native, CVAT, YOLO profiles, verified MOT output                   |
| **5. Testing**         | Real annotation-time measurements and export checks                |

**The first working demonstration should be:**

```text
Open video → N → draw A → E or draw B
→ resize → F → D → assign ID
→ close project → reopen with everything preserved
```

**Make that work smoothly with AI disabled first. Then add GPU assistance.**

[1]: https://konvajs.org/docs/react/Transformer.html "How to resize and rotate canvas shapes with React and Konva? | Konva - JavaScript Canvas 2d Library"
[2]: https://docs.ultralytics.com/modes/predict?utm_source=chatgpt.com "Model Prediction with Ultralytics YOLO"
[3]: https://fastapi.tiangolo.com/tutorial/background-tasks/ "Background Tasks - FastAPI"
[4]: https://pyav.org/docs/stable/api/container.html "Containers — PyAV 9.0.2 documentation"
[5]: https://docs.cvat.ai/docs/dataset_management/formats/format-cvat/ "CVAT for image | CVAT"
[6]: https://docs.ultralytics.com/datasets/detect/ "Object Detection Datasets Overview | Ultralytics"
