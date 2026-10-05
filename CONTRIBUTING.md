# Contributing to Frameinsight

Use the source setup and test commands in the README. Work against an isolated `FRAMEINSIGHT_DATA` directory; never run acceptance tests on an annotator’s working database.

Use [New issue](https://github.com/frameinsight/frameinsight-annotator/issues/new/choose) and choose **Bug report** or **Feature request**. Report one problem or idea per issue and check existing issues first.

The bug form requires your operating system and version, Frameinsight version, installation method, browser, actual behavior, reproduction steps, expected behavior and how often it happens. Find the app version beside **LOCAL** at the top of Frameinsight. If the app cannot open or you cannot find a version, explain that in the field. Include relevant frame numbers, track IDs and class names in the steps. Screenshots, short recordings and error logs are optional; synthetic videos and minimal anonymized annotations are ideal. Do not include private videos, credentials or personal annotation data.

The feature form asks about your current workflow, proposed behavior and who benefits. Blank issues are disabled for regular contributors; GitHub still allows maintainers to create them.

Before opening a pull request:

1. Keep the change focused and describe the behavior it fixes.
2. Preserve saved annotations, exact undo/redo history and compatibility with older backups. Model/export changes need explicit format versioning.
3. Run relevant backend and frontend tests, the production frontend build, and browser tests for changed workflows.
4. Check keyboard navigation, readable error messages, smaller laptop screens and the complete review/export flow.
5. Update the beginner guide and JSON reference when behavior or formats change.

Annotation features must not silently overwrite a human correction, fill an explicit deletion barrier, reassign an identity, or omit a class from delivery. Display filters must not change exported labels. Keep manual annotation usable offline without model downloads.

By submitting a contribution, you agree that it is provided under this project’s MIT license. Third-party code and assets need compatible licensing and attribution.
