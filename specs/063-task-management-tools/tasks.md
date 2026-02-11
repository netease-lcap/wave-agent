# Tasks: Task Management Tools

**Input**: Design documents from `/specs/063-task-management-tools/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create directory structure for task storage in `~/.wave/tasks/`
- [X] T002 [P] Define `Task` and `TaskStatus` types in `packages/agent-sdk/src/types/tasks.ts`
- [X] T003 [P] Configure Vitest for `agent-sdk` if not already present in `packages/agent-sdk/vitest.config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement `TaskManager` service for file-based persistence in `packages/agent-sdk/src/services/taskManager.ts`
- [X] T005 [P] Add `sessionId` retrieval logic to `ToolContext` in `packages/agent-sdk/src/types.ts`
- [ ] T006 [P] Create base tool class or helper for task tools in `packages/agent-sdk/src/tools/taskBase.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Create and Track a Task (Priority: P1) 🎯 MVP

**Goal**: Enable users to create tasks and retrieve their details.

**Independent Test**: Call `TaskCreate` to create a task, then call `TaskGet` with the returned ID to verify the content matches.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T007 [P] [US1] Unit tests for `TaskCreate` tool in `packages/agent-sdk/tests/tools/taskCreate.test.ts`
- [X] T008 [P] [US1] Unit tests for `TaskGet` tool in `packages/agent-sdk/tests/tools/taskGet.test.ts`
- [X] T009 [US1] Integration test for Create -> Get flow in `packages/agent-sdk/tests/integration/taskFlow.test.ts`

### Implementation for User Story 1

- [X] T010 [US1] Implement `TaskCreate` tool in `packages/agent-sdk/src/tools/taskCreate.ts`
- [X] T011 [US1] Implement `TaskGet` tool in `packages/agent-sdk/src/tools/taskGet.ts`
- [X] T012 [US1] Register `TaskCreate` and `TaskGet` in `packages/agent-sdk/src/managers/toolManager.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Update Task Progress (Priority: P2)

**Goal**: Allow updating task status, metadata, and dependencies.

**Independent Test**: Create a task, call `TaskUpdate` to change its status to `in_progress`, then verify with `TaskGet`.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T013 [P] [US2] Unit tests for `TaskUpdate` tool in `packages/agent-sdk/tests/tools/taskUpdate.test.ts`
- [X] T014 [US2] Integration test for status transitions and dependency updates in `packages/agent-sdk/tests/integration/taskUpdate.test.ts`

### Implementation for User Story 2

- [X] T015 [US2] Implement `TaskUpdate` tool in `packages/agent-sdk/src/tools/taskUpdate.ts`
- [X] T016 [US2] Register `TaskUpdate` in `packages/agent-sdk/src/managers/toolManager.ts`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - List All Tasks (Priority: P3)

**Goal**: Provide a summary list of all tasks in the current session.

**Independent Test**: Create multiple tasks and call `TaskList` to verify all are returned in the summary.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T017 [P] [US3] Unit tests for `TaskList` tool in `packages/agent-sdk/tests/tools/taskList.test.ts`
- [X] T018 [US3] Integration test for listing multiple tasks in `packages/agent-sdk/tests/integration/taskList.test.ts`

### Implementation for User Story 3

- [X] T019 [US3] Implement `TaskList` tool in `packages/agent-sdk/src/tools/taskList.ts`
- [X] T020 [US3] Register `TaskList` in `packages/agent-sdk/src/managers/toolManager.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - Decommission Legacy TodoWrite Tool (Priority: P4)

**Goal**: Remove the old `TodoWrite` tool and update documentation.

**Independent Test**: Verify `TodoWrite` is no longer in the tool registry and its implementation files are removed.

### Implementation for User Story 4

- [X] T021 [US4] Remove `TodoWrite` tool registration from `packages/agent-sdk/src/managers/toolManager.ts`
- [X] T022 [US4] Delete `TodoWrite` implementation file `packages/agent-sdk/src/tools/todoWriteTool.ts`
- [X] T023 [US4] Update system prompts and internal docs to remove `TodoWrite` references in `packages/agent-sdk/src/prompts/`

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T024 [P] Finalize `quickstart.md` validation and examples
- [X] T025 [P] Run `pnpm run type-check` and `pnpm run lint` across `agent-sdk`
- [X] T026 [P] Verify `pnpm test:coverage` in `packages/agent-sdk` meets or exceeds previous levels
- [X] T027 [P] Build `agent-sdk` using `pnpm build` to ensure all changes are propagated

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P2)**: Can start after Foundational (Phase 2)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2)
- **User Story 4 (P4)**: Can start after US1-US3 are stable

### Parallel Opportunities

- T002, T003 (Setup)
- T005, T006 (Foundational)
- T007, T008 (US1 Tests)
- T013 (US2 Tests)
- T017 (US3 Tests)
- T024-T027 (Polish)

---

## Implementation Strategy

### Task Delegation (CRITICAL)
Tasks in this file MUST be delegated to specialized subagents whenever possible.
- Use `typescript-expert` for implementation and type fixes.
- Use `vitest-expert` for creating and running tests.
- Use `Explore` for codebase research.

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
