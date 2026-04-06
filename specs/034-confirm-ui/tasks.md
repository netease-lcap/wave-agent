# Tasks: Confirm UI

**Input**: Design documents from `/specs/034-confirm-ui/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Core Infrastructure

**Purpose**: Foundation for confirmation system

- [X] T001 [P] Define `PermissionDecision` and `ToolPermissionContext` types in `packages/agent-sdk/src/types/permissions.ts`
- [X] T002 [P] Create `ConfirmationDetails` component skeleton in `packages/code/src/components/ConfirmationDetails.tsx`
- [X] T003 [P] Create `ConfirmationSelector` component skeleton in `packages/code/src/components/ConfirmationSelector.tsx`
- [X] T004 Add confirmation state to `useChat` context in `packages/code/src/contexts/useChat.tsx`

---

## Phase 2: User Story 1 - Basic Tool Confirmation (Priority: P1) 🎯 MVP

**Goal**: Display confirmation UI with tool details and basic allow/deny options.

**Independent Test**: Trigger a Bash tool, verify confirmation appears with correct details, select allow/deny.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T005 [P] [US1] Unit test for `ConfirmationDetails` rendering in `packages/code/tests/components/ConfirmationDetails.test.tsx`
- [X] T006 [P] [US1] Unit test for `ConfirmationSelector` option selection in `packages/code/tests/components/ConfirmationSelector.test.tsx`

### Implementation for User Story 1

- [X] T007 [US1] Implement tool name and action description display in `ConfirmationDetails.tsx`
- [X] T008 [US1] Implement diff preview for Edit/Write tools in `DiffDisplay.tsx`
- [X] T009 [US1] Implement option navigation (arrow keys, Tab) in `ConfirmationSelector.tsx`
- [X] T010 [US1] Implement allow/deny decision handling in `ConfirmationSelector.tsx`
- [X] T011 [US1] Connect `ConfirmationSelector` to `useChat` decision handler

**Checkpoint**: At this point, basic confirmations should work for Bash, Write, and Edit tools.

---

## Phase 3: User Story 2 - Persistent Permission Mode (Priority: P1)

**Goal**: Allow users to set persistent permissions for specific operations.

**Independent Test**: Select "don't ask again", trigger same operation, verify no confirmation appears.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T012 [P] [US2] Unit test for persistent option visibility in `packages/code/tests/components/ConfirmationSelector.test.tsx`

### Implementation for User Story 2

- [X] T013 [US2] Implement "don't ask again" option with suggested prefix in `ConfirmationSelector.tsx`
- [X] T014 [US2] Handle `newPermissionRule` and `newPermissionMode` in decision handler
- [X] T015 [US2] Implement special handling for mkdir commands (auto-accept edits mode)

**Checkpoint**: At this point, persistent permissions should work for Bash commands.

---

## Phase 4: User Story 3 - Ask User Question Flow (Priority: P2)

**Goal**: Support multi-question flows with single/multi-select options.

**Independent Test**: Trigger AskUserQuestion tool, navigate questions, select options, submit answers.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T016 [P] [US3] Unit test for AskUserQuestion UI flow in `packages/code/tests/components/ConfirmationSelector.test.tsx`

### Implementation for User Story 3

- [X] T017 [US3] Implement question state management in `ConfirmationSelector.tsx`
- [X] T018 [US3] Implement single-select option handling
- [X] T019 [US3] Implement multi-select option handling (Space toggle)
- [X] T020 [US3] Implement "Other" custom text input
- [X] T021 [US3] Implement Tab navigation between questions
- [X] T022 [US3] Implement state preservation with `savedStates`

**Checkpoint**: At this point, AskUserQuestion flows should work completely.

---

## Phase 5: User Story 4 - Plan Mode Approval (Priority: P2)

**Goal**: Display and approve execution plans before implementation.

**Independent Test**: Complete plan mode, verify exit confirmation with plan content.

### Tests for User Story 4 (REQUIRED) ⚠️

- [X] T023 [P] [US4] Unit test for ExitPlanMode confirmation in `packages/code/tests/components/ConfirmationSelector.test.tsx`

### Implementation for User Story 4

- [X] T024 [US4] Implement plan content display in `PlanDisplay.tsx`
- [X] T025 [US4] Implement "clear context" option in `ConfirmationSelector.tsx`
- [X] T026 [US4] Handle `clearContext` flag in decision handler

**Checkpoint**: At this point, plan mode approval should work completely.

---

## Phase 6: User Story 5 - Confirmation Queue (Priority: P2)

**Goal**: Process multiple confirmations sequentially.

**Independent Test**: Trigger multiple confirmations rapidly, verify they appear one at a time.

### Tests for User Story 5 (REQUIRED) ⚠️

- [X] T027 [P] [US5] Unit test for confirmation queue processing in `packages/code/tests/contexts/useChat.test.ts`

### Implementation for User Story 5

- [X] T028 [US5] Implement confirmation queue in `useChat.tsx`
- [X] T029 [US5] Implement queue processing logic (`processNextConfirmation`)
- [X] T030 [US5] Implement ESC cancellation for current confirmation only

**Checkpoint**: At this point, all confirmation types should queue and process correctly.

---

## Phase 7: Polish & Edge Cases

**Purpose**: Handle edge cases and improve UX

- [X] T031 [P] Implement static mode for terminal overflow in `ChatInterface.tsx` (measure height, switch to `<Static>`)
- [X] T032 [P] Implement remount after static mode exit (clear screen, increment remountKey)
- [X] T033 [P] Implement color-coded headers for questions in `ConfirmationSelector.tsx`
- [X] T034 [P] Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [X] T035 Run `quickstart.md` validation scenarios manually

---

## Dependencies & Execution Order

### Phase Dependencies

- **Core Infrastructure (Phase 1)**: No dependencies.
- **User Story 1 (Phase 2)**: Depends on Core Infrastructure (Phase 1).
- **User Story 2 (Phase 3)**: Depends on User Story 1 (Phase 2).
- **User Story 3 (Phase 4)**: Depends on Core Infrastructure (Phase 1).
- **User Story 4 (Phase 5)**: Depends on Core Infrastructure (Phase 1).
- **User Story 5 (Phase 6)**: Depends on Core Infrastructure (Phase 1).
- **Polish (Phase 7)**: Depends on all user stories.

### Parallel Opportunities

- T001, T002, T003 (Infrastructure)
- T005, T006 (US1 Tests)
- T012, T016, T023, T027 (All tests)
- T031, T032 (Polish)
