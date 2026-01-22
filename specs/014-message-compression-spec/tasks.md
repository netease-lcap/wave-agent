# Tasks: Message Compression

**Input**: Design documents from `/specs/014-message-compression-spec/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Research existing compression logic in `agent-sdk` and `code`
- [X] T002 Document history compression mechanism in `spec.md`
- [X] T003 Document input compression mechanism in `spec.md`
- [X] T004 Define data models for `compress` blocks and `longTextMap` in `data-model.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [ ] T005 [P] Create unit test file for `getMessagesToCompress` in `packages/agent-sdk/tests/utils/messageOperations.test.ts`
- [ ] T006 [P] Create unit test file for `InputManager` paste handling in `packages/code/tests/managers/InputManager.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Automatic History Compression (Priority: P1) 🎯 MVP

**Goal**: Enable automatic summarization of old messages.

**Independent Test**: Mock token usage and verify compression is triggered.

### Tests for User Story 1 (REQUIRED) ⚠️

- [ ] T007 [US1] Write failing tests for `AIManager` triggering compression
- [ ] T008 [US1] Write failing tests for `compress` block conversion to API format

### Implementation for User Story 1

- [X] T009 [US1] Implement `getMessagesToCompress` logic in `packages/agent-sdk/src/utils/messageOperations.ts`
- [X] T010 [US1] Implement summarization call in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T011 [US1] Implement `compress` block handling in `convertMessagesForAPI`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Long Input Placeholder (Priority: P2)

**Goal**: Replace long pasted text with placeholders in the UI.

**Independent Test**: Paste long text and verify placeholder appearance and expansion.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T012 [US2] Write failing tests for paste detection and placeholder generation
- [ ] T013 [US2] Write failing tests for placeholder expansion on submission

### Implementation for User Story 2

- [X] T014 [US2] Implement paste detection and placeholder replacement in `packages/code/src/managers/InputManager.ts`
- [X] T015 [US2] Implement placeholder expansion in `packages/code/src/managers/InputManager.ts`

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T016 [P] Make input compression threshold configurable
- [ ] T017 [P] Investigate if image metadata should be preserved in summaries
- [ ] T018 [P] Final type-check and linting
