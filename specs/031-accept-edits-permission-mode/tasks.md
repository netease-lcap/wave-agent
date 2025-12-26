# Tasks: AcceptEdits Permission Mode

**Input**: Design documents from `/specs/031-accept-edits-permission-mode/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Update `PermissionMode` type in `packages/agent-sdk/src/types/permissions.ts` to include `"acceptEdits"`
- [X] T002 [P] Update `configValidator.ts` in `packages/agent-sdk/src/utils/configValidator.ts` to allow `acceptEdits` in `defaultMode`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Update `PermissionManager.checkPermission` in `packages/agent-sdk/src/managers/permissionManager.ts` to implement `acceptEdits` logic
- [X] T004 [P] Add `getPermissionMode()` and `setPermissionMode(mode: PermissionMode)` to `Agent` class in `packages/agent-sdk/src/agent.ts`
- [X] T005 [P] Add `onPermissionModeChange` callback to `InputManagerCallbacks` in `packages/code/src/managers/InputManager.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Automatic File Edits (Priority: P1) 🎯 MVP

**Goal**: Automatically grant permission for `Edit`, `MultiEdit`, `Delete`, and `Write` operations in `acceptEdits` mode.

**Independent Test**: Set permission mode to `acceptEdits` and verify that file operations proceed without prompts while `Bash` still prompts.

### Implementation for User Story 1

- [X] T006 [US1] Implement `acceptEdits` logic in `PermissionManager.checkPermission` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T007 [US1] Add unit tests for `acceptEdits` mode in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T008 [US1] Run `pnpm build` in `packages/agent-sdk` to propagate changes

**Checkpoint**: At this point, the core `acceptEdits` logic is functional in the SDK.

---

## Phase 4: User Story 4 - SDK Control (Priority: P3)

**Goal**: Programmatically set the permission mode via SDK.

**Independent Test**: Call `agent.setPermissionMode('acceptEdits')` and verify the agent's behavior changes immediately.

### Implementation for User Story 4

- [X] T009 [US4] Implement `getPermissionMode` and `setPermissionMode` in `packages/agent-sdk/src/agent.ts`
- [X] T010 [US4] Add unit tests for dynamic mode switching in `packages/agent-sdk/tests/agent.test.ts`
- [X] T011 [US4] Run `pnpm build` in `packages/agent-sdk`

**Checkpoint**: SDK users can now control the permission mode programmatically.

---

## Phase 5: User Story 2 - CLI Mode Cycling (Priority: P2)

**Goal**: Cycle through permission modes in the CLI using `Shift+Tab`.

**Independent Test**: Press `Shift+Tab` in the CLI and verify the mode cycles and the UI updates.

### Implementation for User Story 2

- [X] T012 [US2] Update `InputManager.handleInput` in `packages/code/src/managers/InputManager.ts` to detect `Shift+Tab` (key.shift && key.tab)
- [X] T013 [US2] Implement mode cycling logic in `InputManager` in `packages/code/src/managers/InputManager.ts`
- [X] T014 [US2] Update `useChat` context in `packages/code/src/contexts/useChat.tsx` to handle permission mode changes from `InputManager`
- [X] T015 [US2] Update `InputBox` in `packages/code/src/components/InputBox.tsx` to display the current permission mode below the input border
- [X] T016 [US2] Add unit tests for `Shift+Tab` cycling in `packages/code/tests/managers/InputManager.test.ts`

**Checkpoint**: CLI users can now cycle modes and see the current mode in the UI.

---

## Phase 6: User Story 3 - Persistent Configuration (Priority: P3)

**Goal**: Support `acceptEdits` in `settings.json` `defaultMode`.

**Independent Test**: Set `defaultMode: "acceptEdits"` in `settings.json` and verify the CLI starts in that mode.

### Implementation for User Story 3

- [X] T017 [US3] Verify `LiveConfigManager` correctly updates `PermissionManager` on config reload in `packages/agent-sdk/src/agent.ts`
- [X] T018 [US3] Add integration test for `defaultMode: "acceptEdits"` in `packages/agent-sdk/tests/integration/config.test.ts`

**Checkpoint**: Persistent configuration for `acceptEdits` is now fully supported.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T019 [P] Update `quickstart.md` with final implementation details
- [X] T020 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [X] T021 Final manual validation of all modes in the CLI

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Core logic, should be implemented first.
- **User Story 4 (US4)**: Depends on US1 logic being available in `Agent`.
- **User Story 2 (US2)**: Depends on US1 and US4 for CLI integration.
- **User Story 3 (US3)**: Can be done in parallel with US2 once Foundation is ready.

### Parallel Opportunities

- T001 and T002 can run in parallel.
- T004 and T005 can run in parallel.
- Once Phase 2 is complete, US1 and US3 can potentially start in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 & 4)

1. Complete Phase 1 & 2.
2. Complete Phase 3 (US1) and Phase 4 (US4).
3. **STOP and VALIDATE**: Verify SDK can switch to `acceptEdits` and it works.

### Incremental Delivery

1. Add CLI cycling (US2).
2. Add persistent config (US3).
3. Final polish.
