# Tasks: Memory Management

**Input**: Design documents from `/specs/018-memory-management-spec/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Research existing memory service and manager logic
- [X] T002 Document Project vs. User memory distinction in spec.md
- [X] T003 Document the `#` trigger and saving flow in spec.md
- [X] T004 Define data models and storage formats in data-model.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [ ] T005 [P] Create unit test file for memory service in `packages/agent-sdk/tests/services/memory.test.ts`
- [ ] T006 [P] Create unit test file for `MemoryTypeSelector` component in `packages/code/tests/components/MemoryTypeSelector.test.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 & 2 - Save Memory (Priority: P1) 🎯 MVP

**Goal**: Enable saving project and user memory via `#` trigger.

**Independent Test**: Type `# test memory` and verify it can be saved to either project or user storage.

### Tests for User Story 1 & 2 (REQUIRED) ⚠️

- [ ] T007 [US1,US2] Write failing tests for `#` trigger detection
- [ ] T008 [US1,US2] Write failing tests for file writing (Project vs User)

### Implementation for User Story 1 & 2

- [X] T009 [US1,US2] Implement `#` trigger detection in `packages/code/src/managers/InputManager.ts`
- [X] T010 [US1,US2] Implement `MemoryTypeSelector` component in `packages/code/src/components/MemoryTypeSelector.tsx`
- [X] T011 [US1,US2] Implement memory saving logic in `packages/agent-sdk/src/services/memory.ts`
- [X] T012 [US1,US2] Integrate memory retrieval into `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: User Stories 1 and 2 are fully functional and testable independently.

---

## Phase 4: User Story 3 - Manage Memory (Priority: P2)

**Goal**: Allow viewing and deleting memory entries.

**Independent Test**: Open memory management UI and delete an entry.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T013 [US3] Write failing tests for memory entry deletion

### Implementation for User Story 3

- [ ] T014 [US3] Create a UI component for managing (viewing/deleting) memory
- [ ] T015 [US3] Implement deletion logic in `packages/agent-sdk/src/services/memory.ts`

**Checkpoint**: All user stories are independently functional.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T016 [P] Implement deduplication logic in `addMemory`
- [ ] T017 [P] Explore RAG-based retrieval for large memory files
- [ ] T018 [P] Final type-check and linting
