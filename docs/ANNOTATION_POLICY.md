# Current annotation policy

The editor uses one class: `person_visible`, the smallest axis-aligned rectangle containing all visible evidence belonging to one person. A box can enclose background between visible body parts; it is not a segmentation mask. Do not invent hidden body parts.

Coordinates are floating-point original-image pixels, with positive area and boundaries clamped to the decoded image. Whole-frame completion requires visible boxes and verified segment identities; separate person approvals are not required. Occlusion, border truncation and notes are optional. No visibility fraction is calculated from box areas or flags.

Historical `person_ext` data is preserved but hidden. New manual, copied and interpolated observations create only visible geometry. Visible-only approval does not require full-quality metadata or containment within an old full-body box. The historical full/dual export helpers retain their stricter checks; those profiles are not exposed by the current editor.

Keyframe interpolation materializes editable drafts between supported visible endpoints in the same verified segment. Source timestamps determine interpolation when the complete span has increasing timestamps; otherwise source indices are used. There is no extrapolation, cross-person interpolation or filling across gaps. Manual/corrected observations and all approved observations are protected anchors. Corrections update adjacent generated drafts. The originating edit and all interpolation changes form one undoable, durably saved operation.

G starts a gap on the first fully invisible frame; H resumes at the first visible return, ending the gap at H−1. Intervals use inclusive zero-based source indices. Positive observations cannot lie within a gap. Same, different and unresolved return decisions require evidence. Unresolved returns use provisional identities. Numeric IDs are positive and unique within the project; internal identity UUIDs are permanent. Merges reject same-frame contradictions and gap conflicts. Identity/segment decisions are undoable.

Enter and F/D navigate; drawing and adjustments save automatically without any person-approval step. Corrections remain protected keyframes. Ctrl+Enter performs one whole-image check for export, accepting all valid visible boxes regardless of their historical review_state. Edits invalidate affected whole-frame checks. Historical approved observations retain their interpolation protection.
