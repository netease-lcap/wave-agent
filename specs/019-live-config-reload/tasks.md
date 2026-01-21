# Tasks: Live Configuration Reload

**Input**: Design documents from `/specs/019-live-config-reload/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL and not explicitly requested in the feature specification

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo structure**: `packages/agent-sdk/src/` for SDK modifications
- All paths relative to repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Add Chokidar dependency to packages/agent-sdk/package.json
- [x] T002 [P] Install development dependencies @types/chokidar in packages/agent-sdk/package.json
- [x] T003 [P] Build agent-sdk package to prepare for modifications

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Rename HookConfiguration to WaveConfiguration in packages/agent-sdk/src/types/hooks.ts
- [x] T005 [P] Add env field to WaveConfiguration interface in packages/agent-sdk/src/types/hooks.ts
- [x] T006 [P] Create FileWatcherService class structure in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T008 Update hook service imports to use WaveConfiguration in packages/agent-sdk/src/services/hook.ts
- [x] T009 Update all existing references from HookConfiguration to WaveConfiguration across the codebase

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Custom Environment Variables (Priority: P1) 🎯 MVP

**Goal**: Enable developers to configure environment variables via settings.json files

**Independent Test**: Can create settings.json with env field and verify variables are accessible in agent processes

### Implementation for User Story 1

- [x] T010 [P] [US1] Implement env field validation in packages/agent-sdk/src/services/hook.ts
- [x] T011 [P] [US1] Create EnvironmentValidationResult interface in packages/agent-sdk/src/types/environment.ts
- [x] T012 [P] [US1] Implement environment variable validation logic using EnvironmentValidationResult in packages/agent-sdk/src/services/hook.ts
- [x] T013 [US1] Implement loadWaveConfigFromFile function to replace loadHooksConfigFromFile in packages/agent-sdk/src/services/hook.ts
- [x] T014 [US1] Implement mergeEnvironmentConfig function in packages/agent-sdk/src/services/hook.ts
- [x] T015 [US1] Add environment merging logic with project precedence in packages/agent-sdk/src/services/hook.ts
- [x] T016 [US1] Update loadMergedHooksConfig to loadMergedWaveConfig in packages/agent-sdk/src/services/hook.ts
- [x] T017 [US1] Update Agent constructor to use merged environment variables in packages/agent-sdk/src/agent.ts
- [x] T018 [US1] Add error handling for invalid env field format in packages/agent-sdk/src/services/hook.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Live Settings Reload (Priority: P2)

**Goal**: Enable automatic reload of settings.json changes without restart

**Independent Test**: Can modify settings.json while SDK is running and verify new configuration takes effect on next operation

### Implementation for User Story 2

- [x] T019 [P] [US2] Implement ConfigurationWatcher class in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T020 [P] [US2] Implement FileWatcherService with Chokidar integration in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T021 [US2] Add file watching initialization to LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T022 [US2] Implement configuration reload event handling in LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T023 [US2] Add debouncing and error recovery to file watcher in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T024 [US2] Update hook service to support live reload in packages/agent-sdk/src/services/hook.ts
- [x] T025 [US2] Add logging for configuration reload events in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T026 [US2] Implement graceful fallback when invalid configuration is detected in packages/agent-sdk/src/services/hook.ts
- [x] T027 [US2] Pass logger from Agent constructor to ConfigurationWatcher for structured logging in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T028 [US2] Add structured logging for reload events with Live Config prefix in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T029 [US2] Implement file watcher initialization failure handling with descriptive errors in packages/agent-sdk/src/services/fileWatcher.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T038 [P] Add comprehensive error logging with Live Config prefix across all services
- [x] T039 [P] Implement performance monitoring and metrics collection
- [x] T040 Code cleanup and refactoring for consistency
- [x] T041 [P] Add type safety improvements and remove any types
- [x] T042 [P] Update existing tests that use HookConfiguration to use WaveConfiguration
- [x] T043 Run quickstart.md validation examples
- [x] T044 Build and test agent-sdk package integration

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Uses WaveConfiguration from US1 but should be independently testable

### Within Each User Story

- Interface definitions before implementations
- Services before managers
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Interface definitions within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch interface definitions for User Story 1 together:
Task: "Create EnvironmentValidationResult interface in packages/agent-sdk/src/types/environment.ts"
Task: "Implement environment variable validation logic using EnvironmentValidationResult in packages/agent-sdk/src/services/hook.ts"

# After foundations, these can run in parallel:
Task: "Implement loadWaveConfigFromFile function to replace loadHooksConfigFromFile"
Task: "Implement mergeEnvironmentConfig function"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently with settings.json env field
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (environment variables)
   - Developer B: User Story 2 (live settings reload)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Requires building agent-sdk package after modifications before testing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on SDK-only implementation as specified in plan.md
- Chokidar handles cross-platform file watching complexities automatically
