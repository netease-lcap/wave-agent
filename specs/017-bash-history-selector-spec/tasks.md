# Tasks: Bash History Selector

**Input**: Design documents from `/specs/017-bash-history-selector-spec/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Research existing `BashHistorySelector` and `InputManager` logic
- [X] T002 Document triggering and activation mechanism in spec.md
- [X] T003 Document search and execution/insertion logic in spec.md
- [X] T004 Define data models and interfaces in data-model.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [ ] T005 [P] Create unit test file for history search in `packages/agent-sdk/tests/utils/history.test.ts`
- [ ] T006 [P] Create unit test file for `BashHistorySelector` component in `packages/code/tests/components/BashHistorySelector.test.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Search and Re-execute Commands (Priority: P1) 🎯 MVP

**Goal**: Enable basic history search and execution via `!` trigger.

**Independent Test**: Type `!` at the start of the input and verify the selector appears and allows executing a command.

### Tests for User Story 1 (REQUIRED) ⚠️

- [ ] T007 [US1] Write failing tests for `!` trigger detection at position 0
- [ ] T008 [US1] Write failing tests for immediate command execution on `Enter`

### Implementation for User Story 1

- [X] T009 [US1] Implement `!` trigger detection in `packages/code/src/managers/InputManager.ts`
- [X] T010 [US1] Implement basic `BashHistorySelector` component in `packages/code/src/components/BashHistorySelector.tsx`
- [X] T011 [US1] Implement command execution logic in `packages/code/src/managers/InputManager.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Edit History Commands (Priority: P2)

**Goal**: Allow inserting history commands into the input for editing.

**Independent Test**: Select a command and press `Tab`, then verify it's in the input field.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T012 [US2] Write failing tests for command insertion on `Tab`

### Implementation for User Story 2

- [X] T013 [US2] Implement `Tab` key handling for command insertion in `packages/code/src/components/BashHistorySelector.tsx`
- [X] T014 [US2] Update `InputManager` to handle inserted command state

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 3 - Manage History (Priority: P3)

**Goal**: Allow deleting entries from history.

**Independent Test**: Select a command and press `Ctrl+d`, then verify it's gone from the list.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T015 [US3] Write failing tests for history entry deletion

### Implementation for User Story 3

- [ ] T016 [US3] Implement `Ctrl+d` handling in `packages/code/src/components/BashHistorySelector.tsx`
- [ ] T017 [US3] Implement deletion logic in `wave-agent-sdk` history utility

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T018 [P] Implement fuzzy search for history entries
- [ ] T019 [P] Improve UI display for long/multi-line commands
- [ ] T020 [P] Final type-check and linting
