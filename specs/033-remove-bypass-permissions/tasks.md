# Tasks: Remove Bypass Permissions from Shift+Tab

**Input**: Design documents from `/specs/033-remove-bypass-permissions/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included as they are essential for verifying the logic change in `InputManager`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Verify current state of `packages/code/src/managers/InputManager.ts` and `packages/code/tests/managers/InputManager.permissionMode.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Ensure `packages/agent-sdk` is built and available for `packages/code`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Cycle between Default and Accept Edits (Priority: P1) 🎯 MVP

**Goal**: Modify `Shift+Tab` to only cycle between "Default" and "Accept Edits" modes.

**Independent Test**: Press `Shift+Tab` multiple times and observe that the mode only toggles between "Default" and "Accept Edits".

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T003 [US1] Update `packages/code/tests/managers/InputManager.permissionMode.test.ts` to expect only two modes in the cycle

### Implementation for User Story 1

- [x] T004 [US1] Modify `cyclePermissionMode` in `packages/code/src/managers/InputManager.ts` to restrict the `modes` array to `['default', 'acceptEdits']`
- [x] T005 [US1] Verify implementation by running `pnpm test tests/managers/InputManager.permissionMode.test.ts` in `packages/code`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Handle Bypass Mode Transition (Priority: P2)

**Goal**: Ensure that if the system is in "Bypass Permissions" mode, `Shift+Tab` transitions it back to "Default".

**Independent Test**: Manually set the mode to "Bypass Permissions" and then press `Shift+Tab` to see it return to "Default".

### Tests for User Story 2

- [x] T006 [US2] Add a test case to `packages/code/tests/managers/InputManager.permissionMode.test.ts` that starts in `bypassPermissions` and verifies transition to `default` on `Shift+Tab`

### Implementation for User Story 2

- [x] T007 [US2] Update `cyclePermissionMode` in `packages/code/src/managers/InputManager.ts` to handle cases where the current mode is not in the cycle (e.g., `bypassPermissions`)
- [x] T008 [US2] Verify implementation by running `pnpm test tests/managers/InputManager.permissionMode.test.ts` in `packages/code`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T009 [P] Run `pnpm run type-check` in `packages/code` to ensure no regressions
- [x] T010 [P] Run `pnpm run lint` in `packages/code` to ensure code quality
- [x] T011 [P] Run quickstart.md validation manually in the CLI

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on the logic structure established in US1 but adds a specific case

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently
4. Each story adds value without breaking previous stories
