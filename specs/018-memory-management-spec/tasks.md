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
- [X] T003 Document the memory saving flow in spec.md
- [X] T004 Define data models and storage formats in data-model.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T005 [P] Create unit test file for memory service in `packages/agent-sdk/tests/services/memory.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 & 2 - Save Memory (Priority: P1) 🎯 MVP

**Goal**: Enable saving project and user memory.

**Independent Test**: Ask the agent to remember something and verify it can be saved to either project or user storage.

### Tests for User Story 1 & 2 (REQUIRED) ⚠️

- [X] T007 [US1,US2] Write failing tests for memory saving detection
- [X] T008 [US1,US2] Write failing tests for file writing (Project vs User)

### Implementation for User Story 1 & 2

- [X] T009 [US1,US2] Implement memory saving detection in `packages/agent-sdk/src/prompts/autoMemory.ts`
- [X] T010 [US1,US2] Implement memory saving logic in `packages/agent-sdk/src/services/memory.ts`
- [X] T011 [US1,US2] Integrate memory retrieval into `packages/agent-sdk/src/managers/aiManager.ts`

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

## Phase 6: User Story 4 - Auto-Memory (Priority: P1)

**Goal**: Enable the agent to automatically save and retrieve project-specific knowledge.

**Independent Test**: Perform a task, start a new session, and verify the agent remembers the context.

### Tests for User Story 4 (REQUIRED) ⚠️

- [X] T019 [US4] Write failing tests for auto-memory directory resolution (git worktrees)
- [X] T020 [US4] Write failing tests for auto-memory context injection (200-line limit)
- [X] T021 [US4] Write failing tests for auto-memory "Safe Zone" permission bypass

### Implementation for User Story 4

- [X] T022 [US4] Implement auto-memory directory resolution in `packages/agent-sdk/src/services/memory.ts`
- [X] T023 [US4] Implement auto-memory context injection in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T024 [US4] Update `PermissionManager` to include auto-memory directory as a "Safe Zone"
- [X] T025 [US4] Add `autoMemoryEnabled` setting and environment variable support
- [X] T026 [US4] Ensure auto-memory directory and `MEMORY.md` are initialized on startup

**Checkpoint**: Auto-memory is fully functional and integrated.
