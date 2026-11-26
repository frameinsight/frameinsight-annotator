# Camera Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve #15 and #16 without deleting unrelated annotations.
**Architecture:** Revision-guarded session deletion; atomic mapped-camera replacement using the existing SQLite importer, with explicit impact preview and confirmation.
**Tech Stack:** React, TypeScript, FastAPI, SQLite, pytest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-26-camera-session-management-design.md

## Global Constraints
- Preserve unmapped videos, source media, single-video workflow and large streaming JSON support.
- No new dependencies; default import remains Add.

## Review Focus
- Stale project/session previews must not replace newer work.
- Empty imported cameras must clear old annotations in Replace mode.
- Legacy identities spanning mapped and unmapped videos must retain unmapped geometry.
- Import failure after removals must roll back all changes and session associations.
- Session deletion must preserve other sessions and all local geometry.

### Task 1: Safe session deletion
Files: backend/app/multicam.py, frontend/src/VideoLibrary.tsx, tests/test_multicam.py, tests/browser/multicam-import-feedback.spec.ts.
Interface: DELETE /api/camera-sessions/{id}?revision=N&confirmed=true.
- [x] Write/run failing API test for confirmation, stale revision, deletion and preservation.
- [x] Implement transactional deletion of only session-owned records and library confirmation dialog.
- [x] Run backend tests and browser deletion coverage, then commit.

### Task 2: Mapped-camera replacement
Files: backend/app/multicam_delivery.py, frontend/src/NewCameraSession.tsx, tests/test_multicam_delivery.py, tests/browser/multicam-import-feedback.spec.ts.
Interfaces: import preview accepts optional video_mapping; returns impact with project_revision, replacement_token, per-camera counts and affected_sessions. Import accepts mode and replacement_token; add remains default.
- [x] Write/run failing tests for scoped replacement, empty source, rollback, stale confirmation and other-session impact.
- [x] Implement impact preview and atomic replacement, prune obsolete assignments, preserve shared people from import.
- [x] Add Source import mode, preview table and explicit replacement checkbox; invalidate preview on mapping/mode/file changes.
- [ ] Run backend/frontend/build and browser tests, including Add compatibility, rollback/retry and replacement roundtrip.

### Task 3: Verify and deliver
- [ ] Review diff, run full suites and exercise dialogs in browser.
- [ ] Update user documentation and release notes; push fixes to main, verify remote/CI.
