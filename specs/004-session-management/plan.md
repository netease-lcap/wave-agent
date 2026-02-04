# Plan: Session Management Implementation

This plan outlines the historical steps taken to implement the current session management system.

## Phase 1: Project-Based Directory Structure
- [x] Create `PathEncoder` utility.
- [x] Update `SESSION_DIR` to `~/.wave/projects`.
- [x] Implement directory creation and path encoding logic.

## Phase 2: JSONL Format Migration
- [x] Implement `JsonlHandler` for basic CRUD operations.
- [x] Update `appendMessages` to use atomic appends to JSONL.
- [x] Update `loadSession` to read and parse JSONL lines.

## Phase 3: Metadata Optimization
- [x] Remove metadata header line from JSONL files.
- [x] Implement filename-based ID and type identification.
- [x] Update `listSessions` to use filename parsing and `getLastMessage` for dynamic metadata.

## Phase 4: Subagent Support
- [x] Add `subagent-` prefix to subagent session filenames.
- [x] Update filtering logic in `listSessions` to exclude subagent sessions by default.

## Phase 5: Cleanup & Maintenance
- [x] Implement `cleanupExpiredSessions` (14-day limit).
- [x] Implement `cleanupEmptyProjectDirectories`.
- [x] Add error handling for corrupted JSONL lines.

## Phase 6: Session Indexing & UI Optimization
- [x] Implement `sessions-index.json` for O(1) listing performance.
- [x] Cache `firstMessage` content in the index for instant UI summaries.
- [x] Implement automatic index rebuilding from source-of-truth `.jsonl` files.
- [x] Refactor CLI (`session-selector-cli.tsx`) to use cached index data, eliminating per-session file reads.
