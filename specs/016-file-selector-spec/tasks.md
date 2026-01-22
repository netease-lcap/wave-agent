# Tasks: File Selector

**Input**: Design documents from `/specs/016-file-selector-spec/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Research existing `FileSelector` and `InputManager` logic
- [X] T002 Document triggering and activation mechanism in spec.md
- [X] T003 Document search and debouncing logic in spec.md
- [X] T004 Define data models and interfaces in data-model.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [ ] T005 [P] Create unit test file for `InputManager` state transitions in packages/code/tests/managers/InputManager.test.ts
- [ ] T006 [P] Create unit test file for `FileSelector` component in packages/code/tests/components/FileSelector.test.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Quick File Selection (Priority: P1) 🎯 MVP

**Goal**: Enable basic file selection via `@` trigger.

**Independent Test**: Type `@` in the input field and verify the selector appears and allows selecting a file.

### Tests for User Story 1 (REQUIRED) ⚠️

- [ ] T007 [US1] Write failing tests for `@` trigger detection in `InputManager`
- [ ] T008 [US1] Write failing tests for file path insertion in `InputManager`

### Implementation for User Story 1

- [X] T009 [US1] Implement `@` trigger detection in `packages/code/src/managers/InputManager.ts`
- [X] T010 [US1] Implement basic `FileSelector` component in `packages/code/src/components/FileSelector.tsx`
- [X] T011 [US1] Implement file path insertion logic in `packages/code/src/managers/InputManager.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Directory Navigation (Priority: P2)

**Goal**: Allow navigating through directories in the selector.

**Independent Test**: Select a directory in the selector and verify it shows the contents of that directory.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T012 [US2] Write failing tests for directory selection and content updating

### Implementation for User Story 2

- [X] T013 [US2] Update `FileSelector` to handle directory selection
- [X] T014 [US2] Implement recursive search/navigation logic

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 3 - Fuzzy Search (Priority: P3)

**Goal**: Implement fuzzy search for better matching.

**Independent Test**: Type a fuzzy query and verify relevant files are found.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T015 [US3] Write failing tests for fuzzy matching logic

### Implementation for User Story 3

- [ ] T016 [US3] Implement fuzzy search for file matching in `packages/code/src/managers/InputManager.ts` or `wave-agent-sdk`
- [ ] T017 [US3] Add support for home directory (`~`) expansion

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T018 [P] Add icons for different file types in `FileSelector`
- [ ] T019 [P] Improve scrolling performance for large directories
- [ ] T020 [P] Final type-check and linting
