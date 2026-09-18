# Frameinsight: current capabilities and proposed Jira backlog

Status reviewed: 18 September 2026, application version 1.2.0. This is a planning document, not a claim that proposed features are implemented. Ticket references below are local planning labels, not existing Jira issue IDs.

## Product objective

Produce reliable person-detection labels, consistent person tracks, and validated trajectories for motion prediction, while keeping the annotator's default workflow simple. Advanced annotation and model assistance should be optional. The manual editor must remain usable offline on older laptops.

## Current features

| Area | Implemented behavior |
|---|---|
| Video library | Lists imported videos; search, reopen, and distinguish In progress/Finished. |
| New video setup | Enter the number of classes and their names, then upload a video. |
| Box annotation | Draw one rectangular box per person observation; move, resize, replace, and delete boxes. |
| Person identity | Assign numeric IDs; reuse an existing ID, including when adding an earlier part of a track. Conflicting assignments are rejected. |
| Classes and colors | Press I to select/create a class and choose a box color. Class/color currently apply to the person's track. |
| Interpolation | Fill boxes between supported keyframes; timestamps are used when valid, with a frame-index fallback. Correcting a generated box creates a protected anchor and updates neighboring generated boxes. |
| Track gaps | Mark disappearance, resume the track on return, and end a track. Interpolation does not cross explicit gaps or extend beyond supported endpoints. |
| Overlapping people | Hide/show individual people, focus on one, restore all, and delete a person's annotations with confirmation and Undo. Hiding does not remove exported annotations. |
| Navigation | Exact decoded frames and source timestamps, frame jumps, playback, nearby-frame previews, zoom/pan, and fit-to-screen. |
| Productivity | Keyboard shortcuts, configurable bindings, shortcut sidebar, copy previous box, Undo/Redo. |
| Saving | Autosave, Save button, Ctrl+S, local pending-edit recovery, retry after disconnection, and saved edit history. |
| Finish flow | User confirms every person was annotated/tracked, then accesses export options. Editing finished work marks it In progress again. This is a user declaration, not automatic quality validation. |
| Annotation export | Selected-video JSON containing boxes, IDs, classes/colors, frame timing, gaps, provenance, and relevant edit history. No embedded video or images. |
| Backup/restore | Media-free native project ZIP export and native ZIP restore with matching source videos available. Direct custom-JSON re-import is not implemented. |
| Deployment | Local Ubuntu app and Windows 10/11 64-bit installer. Windows installation/runtime tested under Wine; native Windows testing remains outstanding. |

The simplified UI exposes JSON and native backup exports. Legacy YOLO/MOT/CVAT conversion code and detector infrastructure exist, but they are not the current user-facing workflow. They need integration and validation against the configurable classes and current Finish flow. The Windows package does not bundle detector weights.

Current interpolation is box-coordinate interpolation, not image-aware tracking or future prediction. There are no current direction arrows, trajectory forecasts, or trained motion models.

## Proposed Jira tickets

P0 = foundation before trusting training datasets. P1 = next high-value capability. P2 = advanced capability after measured need. Each entry can become one Jira story or an epic with smaller implementation tasks.

### P0 — Reliable labels and usable delivery

**F01 — Define annotation rules and class templates**

- Scope: Provide short visual examples for visible-person boxes, image-border truncation, partial occlusion, complete disappearance, and ID reuse. Version each project's annotation policy.
- Acceptance: A beginner can select a supplied template and view examples in Help; exports record the policy version. A class named `person_extended` alone must not imply paired full-body geometry support.
- Dependencies: None.

**F02 — Add optional observation attributes and coverage scope**

- Scope: Per-frame or frame-range occlusion, truncation, visibility uncertainty, and notes. Let users declare all-person coverage, selected-person-only coverage, or unreviewed coverage.
- Acceptance: Attributes can change within one track without changing its ID/class. Unknown is distinct from false. Unlabelled people in partial annotations are not silently treated as training background. Existing single-person datasets remain valid partial annotations.
- Dependencies: F01.

**F03 — Add a quality-check report before dataset release**

- Scope: Flag duplicate overlapping identities, abrupt box jumps, suspicious size changes, short track fragments, unsupported long interpolation spans, and inconsistencies between gaps and boxes. Provide direct navigation to each issue.
- Acceptance: Each finding can be corrected or dismissed with a reason. Potential missed people require human inspection or explicitly identified model suggestions; the checker cannot certify that everybody was found. Generated boxes and checked boxes remain distinguishable. No mandatory per-box approval button in the everyday drawing flow.
- Dependencies: F01–F02.

**F04 — Expose track repair tools in a simple UI**

- Scope: Split a track at a frame, merge non-conflicting tracks, reassign an interval to another ID, and repair an ID swap between two people.
- Acceptance: Preview affected frame ranges before applying; reject incompatible same-frame boxes/gaps; preserve class metadata, provide Undo, and keep an audit record. Extend existing ID reuse and internal segment logic rather than duplicating it.
- Dependencies: F03.

**F05 — Add training-ready, media-free dataset conversion**

- Scope: Adapt existing conversion code to export configurable YOLO class mappings/labels, MOT tracking labels, and a source-frame manifest. Keep originals separate; provide a converter that reads locally supplied videos when a trainer needs images. Add versioned custom-JSON import with source-hash matching and clear validation errors.
- Acceptance: Check coordinate/frame/class round trips; preserve track IDs in a sidecar where the target format cannot represent them; report excluded/unreviewed frames. Do not change the user's annotation-only delivery requirement. Explain that detector training still needs access to the corresponding images/video outside the annotation export.
- Dependencies: F01–F03.

**F06 — Add reproducible dataset versions and safe splits**

- Scope: Freeze export revisions, record class maps and source hashes, and assign train/validation/test groups by recording session/camera as appropriate. Keep adjacent clips and repeated identities from leaking across splits where possible.
- Acceptance: Re-running an export reproduces its manifest and split assignment; automated checks flag related clips crossing splits. Test data stays separate from model selection and active-learning sampling.
- Dependencies: F05.

**F07 — Validate Windows and older-laptop operation**

- Scope: Test clean install/update/uninstall on real Windows 10/11, crash recovery, video relinking, disk usage, and long-video responsiveness. Add cache limits/cleanup and in-app archive/reset with backup. Isolate automated-test projects from user data.
- Acceptance: Record hardware and measured startup/navigation/memory/disk results; establish performance targets from those measurements. Crash/update preserves saved work. Tests leave no sample projects in the user library. Manual annotation works without model downloads or a GPU.
- Dependencies: None.

### P1 — Movement, prediction, and optional assistance

**F08 — Add trajectory trails and current movement arrows**

- Scope: Display a person's past path, an eight-direction arrow, and Stationary/Unknown. Derive screen-space velocity from timestamped positions over a configurable history window. Define the tracked point explicitly; optionally annotate a ground-contact point because the center of a visible box can shift during occlusion.
- Acceptance: Support variable frame rates, noise smoothing, minimum movement thresholds, manual corrections, and uncertain/missing positions. Use pixels/second or normalized-image units, not metres/second without calibration. Do not infer direction across a gap. Recalculate derived arrows after box edits and label their provenance.
- Dependencies: F02–F03.

**F09 — Add optional facing-direction annotation**

- Scope: Let an annotator set body-facing direction and Unknown over a frame range; keep it separate from travel direction. If needed later, distinguish body heading from head/gaze orientation.
- Acceptance: A stationary person may have a known facing direction; a backwards-walking person may have different facing and movement directions. Labels change over time without creating a new class or ID.
- Dependencies: F02.

**F10 — Build future-trajectory training samples**

- Scope: Generate timestamp-based history/target samples for configurable horizons such as 0.5, 1, and 2 seconds. Use later observed positions as the outcome; the annotator does not guess the future.
- Acceptance: Store input cutoff, actual target timestamps, horizon, point convention, coordinate space, masks, and manual/interpolated/corrected provenance. Gaps, track ends, cuts, and unavailable outcomes produce masks/exclusions. Unchecked interpolation cannot become verified ground truth. Input features must be computed only from observations available at the cutoff; review interpolation anchors and smoothing to prevent future leakage. Split before forming overlapping windows.
- Dependencies: F02, F06, F08.

**F11 — Add a baseline future-path predictor**

- Scope: Implement constant-velocity and/or Kalman-based forecasts from past/current positions. Display predicted path separately from observed history, with the horizon and uncertainty clearly indicated.
- Acceptance: Evaluation runs causally without accessing later frames/labels. Predictions never overwrite annotations. Report errors by horizon and compare moving, stationary, turning, and occluded cases. Unknown/insufficient history is supported. Treat this as a measured baseline, not reliable knowledge of a person's intention.
- Dependencies: F08, F10, F14.

**F12 — Add optional detection and tracking suggestions**

- Scope: An optional advanced mode runs a supplied person detector plus a tracker such as ByteTrack or BoT-SORT and proposes boxes/IDs. Keep manual mode as the default. Reuse compatible detector infrastructure.
- Acceptance: Run/pause/cancel selected ranges; distinguish suggestions from saved annotations; accept/reject/correct without overwriting manual anchors. Store model/configuration versions. Benchmark CPU and optional accelerated execution, with heavy processing available outside the annotator's laptop.
- Dependencies: F03–F07.

**F13 — Add re-identification assistance after occlusion**

- Scope: Rank candidate existing IDs when a person reappears, using appearance and feasible motion. Present candidates for human review.
- Acceptance: Measure ID switches and false joins on crowded/look-alike examples. Low-confidence cases remain unresolved; do not silently force a match. Record the selected candidate and supporting model version. Initially limit to one video/camera.
- Dependencies: F04, F12, F14.

**F14 — Add an evaluation dashboard and error review**

- Scope: Measure detector precision/recall and mAP, tracking HOTA/IDF1/ID switches, and forecast average/final displacement error by time horizon. Measure throughput, latency, and memory on named hardware.
- Acceptance: Evaluate frozen model/dataset versions on held-out footage; show errors by camera, person size, crowding, lighting, and occlusion. Report coordinate units, sample counts, missing-target exclusions, and baseline comparisons. For multiple candidate futures, report candidate count and probability quality as well as best-of-K error so extra guesses do not masquerade as better predictions.
- Dependencies: F05–F06; forecasting section additionally needs F10.

### P2 — Advanced improvements

**F15 — Train a learned, multiple-future trajectory model**

- Scope: Learn from past tracks and optional scene/pose context; allow several plausible future paths rather than claiming one certain outcome.
- Acceptance: Demonstrate improvement over F11 on held-out recordings, including turns and stopping, at an acceptable measured runtime. Report uncertainty and horizon-specific results. Retain the simple baseline if the learned model does not help.
- Dependencies: F10–F11, F14; optional F16/F17.

**F16 — Add camera calibration and scene context**

- Scope: Ground-plane calibration, camera-motion handling, walkable regions, obstacles, and entry/exit zones. Include optional line-crossing and dwell-time analytics built on validated tracks.
- Acceptance: Verify known distances and reprojection errors. Real-world speed/direction is available only within the calibration's valid region and assumptions. Camera movement invalidates or updates calibration. Do not turn a visibility-box corner into an assumed ground-contact measurement.
- Dependencies: F08, F14.

**F17 — Add optional pose and paired visible/full-body annotation**

- Scope: Advanced mode supports keypoints and/or two explicitly linked boxes for one person: observed visible extent and estimated full-body extent. Default UI remains one-box annotation.
- Acceptance: Preserve one identity, distinguish measured/estimated/unknown body parts, version the schema, and validate task-specific exports. Entering two class names alone does not implement this feature. Do not derive a true visible-body percentage from the ratio of two box areas.
- Dependencies: F01–F03, F05.

**F18 — Prioritize difficult examples for annotation**

- Scope: Select varied uncertain detections, likely ID switches, poor forecasts, small people, heavy occlusion, and new environments for review.
- Acceptance: Offer diverse clips rather than many neighboring copies of one failure. Keep the test set untouched and measure whether a subsequent training cycle improves held-out results.
- Dependencies: F12, F14; optionally F15.

**F19 — Support team review and annotation handoff**

- Scope: Assign videos/ranges, record annotator/reviewer identity, show differences, lock or reconcile concurrent edits, and export review status.
- Acceptance: No silent last-writer-wins loss; incomplete, complete, and independently reviewed work are distinct. Offline handoff and restore work without requiring the beginner to configure a server.
- Dependencies: F03, F05–F07.

**F20 — Add cross-camera person association**

- Scope: Separate camera-local track IDs from optional cross-camera identity links; support clock offsets, camera transitions, and reviewed matching candidates.
- Acceptance: Unknown identity remains valid; verify matches against a labelled multi-camera benchmark. Time synchronization and camera relationships are explicit, with calibration where spatial matching needs it. Keep this optional because it is a separate, substantially harder task than within-video ID continuity.
- Dependencies: F13–F14, F16, F19.

## Suggested delivery order

1. F01–F07: trustworthy annotations, dataset interchange, and stable operation.
2. F08–F10 plus F14: movement visualization and properly constructed future-motion data.
3. F11–F13: baseline prediction and optional assisted annotation/tracking.
4. F15–F20: choose based on measured failures and actual use cases, rather than adding every feature at once.

Keep forecasting terminology explicit: interpolation fills between known endpoints; tracking associates observations over time; extrapolation predicts beyond the currently available observations. A predicted path is a model output, not a human-verified observation.

## Technical references

- [Ultralytics detection label format](https://docs.ultralytics.com/guides/data-collection-and-annotation): standard detection labels contain class and bounding-box coordinates; richer motion/identity fields need companion data or a task-specific format.
- [Ultralytics tracking documentation](https://docs.ultralytics.com/modes/track): tracker integration and optional appearance-based re-identification.
- [Ultralytics tracking datasets](https://docs.ultralytics.com/datasets/track): standard track mode is not a separate trajectory-prediction training pipeline.
- [TrackEval](https://github.com/JonathonLuiten/TrackEval): HOTA and identity evaluation metrics.
- [Argoverse paper](https://www.argoverse.org/argoverse_paper.pdf): trajectory forecasting evaluated with average and final displacement error. This is a metric reference, not evidence that driving-domain results transfer directly to this person's camera footage.

Current implementation evidence: `frontend/src/App.tsx`, `frontend/src/store.ts`, `frontend/src/interpolation.ts`, `frontend/src/VideoLibrary.tsx`, `backend/app/annotation_export.py`, and `docs/video-flow-verification.json`. Some older documentation describes UI controls that have since been hidden; the current simplified interface and code take precedence.
