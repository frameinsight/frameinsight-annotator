# Contributing to Frameinsight

Use the source setup and test commands in the README. Work against an isolated `FRAMEINSIGHT_DATA` directory; never run acceptance tests on an annotator’s working database.

For a bug report, include the app version, operating system, reproduction steps, expected behavior and actual behavior. Synthetic videos and minimal anonymized annotations are ideal. Do not include private videos, credentials or personal annotation data.

Before opening a pull request:

1. Keep the change focused and describe the behavior it fixes.
2. Preserve saved annotations, exact undo/redo history and compatibility with older backups. Model/export changes need explicit format versioning.
3. Run relevant backend and frontend tests, the production frontend build, and browser tests for changed workflows.
4. Check keyboard navigation, readable error messages, smaller laptop screens and the complete review/export flow.
5. Update the beginner guide and JSON reference when behavior or formats change.

Annotation features must not silently overwrite a human correction, fill an explicit deletion barrier, reassign an identity, or omit a class from delivery. Display filters must not change exported labels. Keep manual annotation usable offline without model downloads.

By submitting a contribution, you agree that it is provided under this project’s MIT license. Third-party code and assets need compatible licensing and attribution.
