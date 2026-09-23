# Historical acceptance results — 18 September 2026

This is the development log for earlier versions, not a statement of current functionality. Some workflows described below have since been replaced. See the [current user guide](USER_GUIDE.md), [3.0.0 release notes](releases/v3.0.0.md), and the packaged verification reports for the current release.

The application runs locally at http://127.0.0.1:8765. Source is implemented, with persistent manual annotation, exact source frames, real model proposals, identity/gap editing, review gates, native/CVAT/YOLO/MOT exports, and native restoration. **The completed export snapshot has 613/613 reviewed-complete frames and 6,904 approved observations at revision 153.** Subsequent live edits are separate; a user adjustment at revision 154 correctly returned one observation to draft. See [clip review](CLIP_REVIEW.md) for methods, corrections and preserved uncertainty.

## Executed verification

| Check | Result | Evidence |
|---|---|---|
| Backend domain/API, VFR decoder, native restoration and format tests | 25 passed | `tests/test_*.py` |
| Source/screen geometry, immutable frame indexing and aggregated timeline review | 7 passed | `frontend/src/*.test.ts` |
| Google Chrome browser acceptance | 11 passed | `browser-results.json`, `tests/browser/` |
| Production TypeScript/Vite build | Passed; bundle-size advisory remains | `frontend/dist/` |
| Real supplied YOLO model on requested video | Completed 613/613 exact frames; 7,820 raw proposals | Project proposal job `9aa1979d-7e44-4aef-b674-0d729c08997d` |
| Real CUDA integration and cache reuse after worker changes | Passed; 24/24 source-frame result paths/dimensions verified; second pass reused all 24 cached frames | `gpu-integration-results.json` |
| Portable real-project native export | Created with original MP4, source hash, 613-frame ledger, proposals, annotations and command history | App Export downloads |
| Real-project visible-only YOLO export | All 613 images and 6,904 B targets; no excluded frames; image hashes and numeric label round trips verified | `artifact-verification.json` |
| Real CVAT server round trip | CVAT 2.75.0 task 27; all 96 geometry tracks, 7,937 positive boxes, 106 outside markers and attributes preserved; max rounding error 0.00493 px | `cvat-server-roundtrip.json` |
| Complete real-project native restoration | Restored all 613 frames; every redecoded PNG hash, source timestamp, annotation and operation history matched | `artifact-verification.json` |
| Annotated playback preview | 613 frames; source PTS preserved exactly | `preview-verification.json` |
| Consistent SQLite backup | Chrome UI backup and final post-restore backup passed integrity checks; final backup retains live revision 154 | `artifact-verification.json` |

Actual Chrome computer use also exercised the real annotation project: drawing/resizing, metadata, approval, persistence and final-frame visual inspection. Full-video annotation combined this with exact-frame regional review and revision-checked batch operations; it was not 6,904 individual mouse draws. The tests are executable, not screenshots of a mock UI. Browser editor tests create separate numbered-video projects and use real mouse gestures. They do not write into the user's real-video project. The navigation benchmark reads that project without changing annotations.

## Covered plan requirements

- Nested A then B draws one physical observation; equal A/B retain distinct geometry fields and export classes.
- Source coordinate transforms survive zoom, pan and panel collapse. B edits release equal linkage; containment errors remain visible drafts and block approval.
- Deleting one linked geometry preserves the other. Geometry selection changes are reflected immediately by keyboard commands.
- Unknown A retains B and an evidence note. Occlusion and image-border truncation are independent.
- F during a held drag commits to the original frame; delayed image responses cannot replace the selected frame. Metadata edits are rejected while its exact image is unavailable.
- Manual draw/edit/approve works with no proposals and a stopped worker. Late proposals remain separate from corrected annotations.
- Gaps prohibit positive observations; return decisions require evidence. Browser tests reverse return/gap operations. Merge rejects simultaneous identities; undo restores the original identities, observations and frame.
- Numeric ID changes after 100 observations retain one identity and both geometry tracks. Conflicting numeric IDs are rejected.
- Navigation saves a small viewing-position record, without cloning the annotation journal. Position survives reload and navigation leaves the project revision unchanged. Queued edits survive browser reload, reconnect and idempotent replay. Server revision/before-state checks reject conflicting writes.
- Aggregated timeline bins become green only when every source frame in that bin is complete; an edited final frame cannot remain hidden in a green bin. Frame completeness is separate from person approval; one labelled person does not automatically complete a crowded frame.
- VFR fixture timestamps and lossless decoded pixels are verified. Actual source PTS is preserved independently of nominal FPS and the camera's burned-in clock.
- CVAT XML round trips through both this application's importer and the real local CVAT 2.75.0 server with explicit person IDs, A/B geometry and outside markers. Native sidecars preserve information not represented by XML.
- YOLO profiles enforce complete-frame/unknown-A policy, retain pair sidecars, preserve explicit empty frames and group whole recordings into one split.
- MOT fixture verifies selected B geometry, one-based frame/xy conversion, nine columns, all source images and timestamp sidecar.
- Native restoration rehashes/redecodes a fixture and preserves remapped proposal-review/provenance references without taking proposals from the original project.
- Worker cache includes source/model/settings/stream/adapter identity. Empty detection frames have completion markers. Two imports of identical bytes cannot overwrite each other's proposals.

## Performance evidence

`navigation-benchmark.json` records the most recent actual measurement, including every sample and worker status. It alternates frames 0 and 1 of the 2880×1620 real video in a 1440×960 Chrome viewport. The report separates cold reload, external automation elapsed time, in-browser key-to-DOM-ready time and two-animation-frame timing. Two-animation-frame timing is an approximation of visible update latency, not a hardware input-to-photon measurement. A loaded, idle worker is not the same as active GPU inference.

The final full-project run (6,904 observations, detector stopped, restore indexing active) measured cold reload at 4,733 ms, external warm-step median/P95 at 177/224 ms, in-browser DOM-ready P95 at 20.5 ms, and two-animation-frame P95 at 103.7 ms. The original full-project measurement before optimization was approximately 236 ms DOM-ready P95 and 497 ms two-frame P95. Removing full-journal cloning from navigation and indexing observations by source frame substantially improved these results. The proposed 100 ms warm visible-update target is **not strictly demonstrated** by the final run.

The implementation was also exercised during the full real-video inference pass. No formal CVAT speed comparison, 60 Hz dragging claim, sustained 100,000-observation benchmark, or inter-annotator agreement measurement is claimed.

## Remaining limits

- The full annotation pass is complete, with **5,871 unknown full extents and five unresolved identity relations preserved**. This is not independent human certification of identity or pixel-perfect box placement. MOT remains blocked; full/dual YOLO excludes unknown-A frames.
- Real CVAT server import/export passed through its installed Django importer/exporter using an isolated task and the exact hashed source video data. The CVAT web upload workflow was not part of this round trip. No external MOT evaluator was run; confirm the documented visibility `-1` convention with the chosen evaluator.
- Optional Quick Link, interpolation and ReID export are not implemented. Offline candidate grouping in `scripts/review_candidates.py` is an inspection aid only; it never writes labels. It produced identity switches at the entrance and is unsuitable for automatic identity approval.
- PNG caching uses considerable disk and indexing time. The supplied clip took about 14 minutes to index progressively; detector inference then took about 6 minutes. The cache has no automatic disk eviction; 15 decoded images are bounded in browser memory.
- The client loads the whole project's annotation state. Large projects need profiling and possibly paging. Use one active editing tab per project; conflict recovery preserves/downloads local commands but does not automatically merge concurrent edits.
- Cancelled indexing can be retried, but rebuilding the exact cache redecodes the video. Frame-range detector passes are not exposed; a restart resumes the matching cached pass.
- The initial build produces a roughly 596 kB uncompressed JavaScript bundle. Vite's chunk-size advisory is not a build failure.
- Synthetic acceptance projects are deliberately retained separately for inspection. They can be recognized by the `Browser acceptance` or `GPU integration acceptance` name.

## Visible-only workflow and editable interpolation — 2026-09-18

The current editor now uses only `person_visible`. Historical A data and immutable completed-clip exports remain intact. New observations, copies and interpolation do not create A. The full-extent controls/shortcuts are hidden; optional metadata does not block visible-only approval. Current CVAT/YOLO/MOT options export visible geometry; native sidecars preserve history.

Validation: 13 frontend unit tests, 27 backend tests and 12 Chrome browser tests passed. The browser suite was updated from dual-box interactions to the current visible-only workflow, retaining persistence, undo/redo, coordinate transforms, navigation-during-drag, stale image, offline recovery, gaps, identity conflicts, text focus and completeness checks. Added automatic interpolation, correction propagation, resize, protected approval, manual K filling, and undo/reload coverage. Historical dual-format validation remains covered by backend compatibility tests. Production build passed.

Also manually exercised through Cua in real Chrome, in a separate `localhost` browser origin to avoid changing the user's active `127.0.0.1` project selection: created a test project, imported the numbered-frame fixture, drew at frames 1 and 10, visually inspected the interpolated frame 5, moved and resized it, reloaded, checked the updated frame 3, and approved without additional metadata. Saved data confirmed ten visible-only observations, a corrected keyframe and the approved observation. Original completed-clip live revision remained 154. See `visible-workflow-verification.json`.

Interpolation is linear rectangle-coordinate estimation, not optical tracking. Generated boxes remain drafts and need review. It does not extrapolate or cross gaps/segments; approved and corrected work is preserved. Performance benchmarks above describe the earlier measurements and were not rerun for this feature.

## No per-person approval step — 2026-09-18

Removed the Approve person button and approval commands from the visible-only editor. Enter now navigates forward. Valid saved boxes are shown as Keyframe or Interpolated, without treating missing individual approval as an error. Current-frame box outlines are solid; optional previous-frame ghosts are off by default. Drawing, skipping frames and correcting earlier interpolation requires no approval action. Interpolation provenance and historical approval protection remain intact.

The separate whole-image completeness check now validates all visible boxes and verified identities together, without individual approval flags. Visible-only YOLO and MOT exports follow this policy; historical full/dual profiles retain approval requirements. Subsequent edits still invalidate affected frame completeness. No existing project was migrated or bulk-approved.

Validation: production build, 13 frontend unit tests, 28 backend tests and 13 Chrome browser tests passed. Added the user's exact six-frame-skip workflow with correction, Enter navigation, reload, whole-frame completion, and a successful visible-only export without any approval command. Backend tests cover unresolved identities and missing geometry as blockers, plus draft-state visible YOLO/MOT export. Cua visual inspection in Chrome confirmed solid borders, zero approval-related issues and the absence of the approval button on the current real-video project; no annotations were edited during this inspection.

## Custom annotations-only JSON export — 2026-09-18

Added a versioned `frameinsight.annotations` JSON export and made it the UI default. It captures the whole project's saved state, exact frame ledger, video references, readable box index, provenance, identity/gap/review records, detector metadata and full timestamped edit history in one SQLite read snapshot. It exports partial/single-person work without completeness gates. No image/video files are read or embedded, even if `include_videos=true` is submitted. Existing ZIP profiles are unchanged. JSON downloads use the proper extension and MIME type. Direct JSON re-import is not implemented; native ZIP remains the existing restore format.

Production build, 31 backend tests, 13 frontend unit tests and the targeted Chrome browser export test passed. Backend tests cover all state/history preservation, nullable metadata, corrected/uncorrected interpolation, no-media fixtures, forced media exclusion, empty projects and JSON response headers. In actual Chrome via Cua, opened Export on the current Test project, verified the JSON default, prepared the export and observed its download link. Parsed the real revision-137 result and saved a copy in deliverables/annotations; counts and file details are recorded in annotation-json-verification.json. No annotation edits were made during export.
