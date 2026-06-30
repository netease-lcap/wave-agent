# Tasks: Server-Managed Config Download

**Input**: Design documents from `/specs/055-server-managed-config/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality.

**Organization**: Tasks grouped by user story.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Core Infrastructure

**Purpose**: RemoteSettingsService with download and caching

- [ ] T001 [P] [US1] Create `RemoteSettingsService` in `packages/agent-sdk/src/services/remoteSettingsService.ts`
  - `downloadManagedSettings()`: Fetch from `WAVE_SERVER_URL/api/v1/managed-settings` with Bearer auth
  - `getCachedSettings()`: Return cached settings from `~/.wave/managed-settings-cache.json`
  - `saveCache(settings, checksum)`: Persist cache to disk
- [ ] T002 [P] [US1] Add managed settings types (RemoteManagedSettings, ManagedSettingsCache) to agent-sdk types
- [ ] T003 [US1] Wire `RemoteSettingsService` into DI container in `containerSetup.ts`
- [ ] T004 [US1] Call `downloadManagedSettings()` during `InitializationService.initialize()` after SSO check

## Phase 2: User Story 2 - Checksum Caching

**Purpose**: Avoid redundant downloads

- [ ] T005 [P] [US2] Implement checksum-based caching: send `If-None-Match` header, handle 304 response
- [ ] T006 [P] [US2] Unit tests for cache hit (304) and cache miss (200) scenarios

## Phase 3: User Story 3 - Settings Merge

**Purpose**: Correct merge priority with local settings

- [ ] T007 [US3] Implement `mergeWithLocal(local, managed)` with priority: managed > local
  - Array fields: managed replaces local entirely
  - Env field: managed overrides matching keys, preserves non-overlapping local keys
  - `model` scalar field: managed overwrites local (admin enforces)
  - Note: `env.WAVE_MODEL` is a lower-priority default — user's `settings.json` `model` field overrides it in `resolveModelConfig()`
- [ ] T008 [US3] Integrate managed settings into `ConfigurationService.resolveSettings()` merge pipeline

## Phase 4: Error Handling & Polish

- [ ] T009 [P] Implement graceful error handling (network errors, invalid JSON, 401/403)
- [ ] T010 [P] Add warning logs for download failures (not blocking startup)
- [ ] T011 Run `pnpm run type-check` and `pnpm lint` across the monorepo

## Dependencies & Execution Order

- **Phase 1**: No dependencies. Core download functionality.
- **Phase 2**: Depends on Phase 1. Caching layer.
- **Phase 3**: Depends on Phase 1. Merge logic.
- **Phase 4**: Depends on all phases. Error handling and polish.
