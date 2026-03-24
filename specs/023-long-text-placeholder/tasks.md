# Tasks: Long Text Placeholder

**Input**: Design documents from `/specs/023-long-text-placeholder/`
**Prerequisites**: spec.md (required for user stories), data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Research existing long text placeholder logic in `code`
- [X] T002 Document long text placeholder mechanism in `spec.md`
- [X] T003 Define data models for `longTextMap` in `data-model.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 [P] Create unit test file for `InputManager` paste handling in `packages/code/tests/managers/InputManager.test.ts`

---

## Phase 3: User Story 1 - Long Input Placeholder (Priority: P1)

**Goal**: Replace long pasted text with placeholders in the UI.

**Independent Test**: Paste long text and verify placeholder appearance and expansion.

### Implementation for User Story 1

- [X] T005 [US1] Implement paste detection and placeholder replacement in `packages/code/src/managers/InputManager.ts`
- [X] T006 [US1] Implement placeholder expansion in `packages/code/src/managers/InputManager.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently.
