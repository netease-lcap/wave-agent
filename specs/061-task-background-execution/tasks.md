# Tasks: Task Background Execution and Management

**Input**: Design documents from `/specs/061-task-background-execution/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit tests and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Define `BackgroundTask` and related types in `packages/agent-sdk/src/types/processes.ts`
- [x] T002 [P] Create `BackgroundTaskManager` skeleton in `packages/agent-sdk/src/managers/backgroundTaskManager.ts`
- [x] T003 [P] Update `AgentCallbacks` in `packages/agent-sdk/src/agent.ts` to include `onTasksChange`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement core logic in `BackgroundTaskManager` (task registry, ID generation) in `packages/agent-sdk/src/managers/backgroundTaskManager.ts`
- [x] T005 [P] Migrate shell execution logic from `BackgroundBashManager` to `BackgroundTaskManager` in `packages/agent-sdk/src/managers/backgroundTaskManager.ts`
- [x] T006 [P] Integrate `BackgroundTaskManager` into `Agent` class in `packages/agent-sdk/src/agent.ts`
- [x] T007 [P] Create unit tests for `BackgroundTaskManager` in `packages/agent-sdk/tests/managers/backgroundTaskManager.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Background Task Execution (Priority: P1) 🎯 MVP

**Goal**: Enable running subagent tasks and shell commands in the background

**Independent Test**: Initiate a task with `run_in_background: true` and verify immediate return of a task ID.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T008 [P] [US1] Integration test for background subagent execution in `packages/agent-sdk/tests/tools/taskTool.test.ts`
- [x] T009 [P] [US1] Integration test for background shell execution in `packages/agent-sdk/tests/tools/bashTool.test.ts`

### Implementation for User Story 1

- [x] T010 [US1] Update `SubagentManager.executeTask` to support non-blocking execution in `packages/agent-sdk/src/managers/subagentManager.ts`
- [x] T011 [US1] Update `Task` tool to support `run_in_background` parameter in `packages/agent-sdk/src/tools/taskTool.ts`
- [x] T012 [US1] Update `Bash` tool to register background shells with `BackgroundTaskManager` in `packages/agent-sdk/src/tools/bashTool.ts`

**Checkpoint**: Background execution is functional for both subagents and shells.

---

## Phase 4: User Story 2 - Task Output Retrieval (Priority: P1)

**Goal**: Retrieve output from running or completed background tasks

**Independent Test**: Use `TaskOutput` tool with a valid task ID and verify output is returned.

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] T013 [P] [US2] Integration test for `TaskOutput` tool in `packages/agent-sdk/tests/tools/taskOutputTool.test.ts`

### Implementation for User Story 2

- [x] T014 [US2] Implement `TaskOutput` tool in `packages/agent-sdk/src/tools/taskOutputTool.ts`
- [x] T015 [US2] Register `TaskOutput` tool in `ToolManager` in `packages/agent-sdk/src/managers/toolManager.ts`
- [x] T016 [US2] Remove `BashOutput` tool from `packages/agent-sdk/src/tools/bashTool.ts` and `ToolManager`

**Checkpoint**: Task output can be retrieved via the unified `TaskOutput` tool.

---

## Phase 5: User Story 3 - Task Termination (Priority: P2)

**Goal**: Terminate running background tasks

**Independent Test**: Use `TaskStop` tool on a running task and verify it stops.

### Tests for User Story 3 (REQUIRED) ⚠️

- [x] T017 [P] [US3] Integration test for `TaskStop` tool in `packages/agent-sdk/tests/tools/taskStopTool.test.ts`

### Implementation for User Story 3

- [x] T018 [US3] Implement `TaskStop` tool in `packages/agent-sdk/src/tools/taskStopTool.ts`
- [x] T019 [US3] Register `TaskStop` tool in `ToolManager` in `packages/agent-sdk/src/managers/toolManager.ts`
- [x] T020 [US3] Remove `KillBash` tool from `packages/agent-sdk/src/tools/bashTool.ts` and `ToolManager`

**Checkpoint**: Background tasks can be terminated via the unified `TaskStop` tool.

---

## Phase 6: User Story 4 - Task Management Command (Priority: P2)

**Goal**: Centralized task management via `/tasks` command

**Independent Test**: Run `/tasks` in CLI and verify list of tasks is displayed.

### Implementation for User Story 4

- [x] T021 [US4] Implement `/tasks` command in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [x] T022 [US4] Remove `/bashes` command from `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [x] T023 [US4] Update `useChat` context to handle `onTasksChange` in `packages/code/src/contexts/useChat.tsx`
- [x] T024 [US4] Update CLI UI to display background tasks in `packages/code/src/components/BackgroundTaskManager.tsx`

**Checkpoint**: Centralized task management is available in the CLI.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T025 [P] Update `quickstart.md` with final implementation details
- [x] T026 [P] Run `pnpm run type-check` and `pnpm lint` across all packages
- [x] T027 [P] Ensure all tests pass with `pnpm test`
- [x] T028 Final code cleanup and refactoring of `BackgroundBashManager` (removal if fully migrated)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: MVP - No dependencies on other stories
- **User Story 2 (P1)**: Depends on US1 (needs tasks to get output from)
- **User Story 3 (P2)**: Depends on US1 (needs tasks to stop)
- **User Story 4 (P2)**: Depends on US1/US2/US3 for full functionality

### Parallel Opportunities

- T002, T003 (Setup)
- T005, T006, T007 (Foundational)
- T008, T009 (US1 Tests)
- T025, T026, T027 (Polish)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Integration test for background subagent execution in packages/agent-sdk/tests/tools/taskTool.test.ts"
Task: "Integration test for background shell execution in packages/agent-sdk/tests/tools/bashTool.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Verify background task initiation and ID return.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → MVP!
3. Add User Story 2 → Output retrieval
4. Add User Story 3 → Termination
5. Add User Story 4 → CLI Management
