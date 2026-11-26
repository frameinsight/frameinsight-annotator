# Camera session management

Implement GitHub issues #15 and #16 in the existing React/FastAPI application.

- Delete session from its library row after a named confirmation explaining that camera membership, timing, shared people and assignments are removed. Keep source videos, local annotations, other sessions and downloaded exports. Require the current session revision and explicit confirmation.
- Multi-camera import defaults to Add. Offer Replace annotations on mapped cameras. Show per-camera existing/imported track and box counts, plus names of other sessions using those videos, before enabling replacement confirmation.
- Reuse native replacement scoping to preserve unmapped videos and identities shared with them. Recreate shared people and assignments from the import in a new session. Remove obsolete assignments from other sessions when their local tracks are replaced.
- Bind confirmation to project revision, mapping and affected session revisions. Reject stale previews; commit annotation replacement and new session atomically. Failed validation or insertion leaves existing annotations/session links untouched.
- Preserve media-free export formats, large streaming JSON support and single-video workflow. No new dependencies.

Approach: extend the existing transactional importer rather than deleting videos or replacing the whole project. Whole-project replacement would erase unrelated work; client-side delete-then-import could lose annotations on failure. Use the existing deletion dialog and import section patterns.

Implementation decisions are delegated by the user's instruction to check, fix, test and push; work proceeds in this session on a temporary branch.
