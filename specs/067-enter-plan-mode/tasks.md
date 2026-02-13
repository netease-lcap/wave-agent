# Tasks: Enter Plan Mode

**Input**: Design documents from `/specs/067-enter-plan-mode/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Register `ENTER_PLAN_MODE` tool name in `packages/agent-sdk/src/constants/tools.ts`
- [X] T002 [P] Define `PLANNING_POLICY` and `RE_ENTRY_REMINDER` constants in `packages/agent-sdk/src/constants/prompts.ts`
- [X] T003 Update `buildSystemPrompt` in `packages/agent-sdk/src/constants/prompts.ts` to inject `PLANNING_POLICY` when `EnterPlanMode` tool is available, and `RE_ENTRY_REMINDER` when re-entering plan mode with an existing file
- [X] T004 [US1] Update `PlanManager` in `packages/agent-sdk/src/managers/planManager.ts` to support retrieving an existing plan file path for the session
- [X] T005 [P] [US1] Unit test for `EnterPlanMode` tool execution and file reuse in `packages/agent-sdk/tests/tools/enterPlanMode.test.ts`
- [X] T006 [P] [US1] Integration test for `EnterPlanMode` re-entry flow in `packages/code/tests/integration/enterPlanMode.feature.test.ts`
- [X] T007 [US1] Implement `enterPlanModeTool` in `packages/agent-sdk/src/tools/enterPlanMode.ts` with reuse logic

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Guidance on When to Plan (Priority: P2)

**Goal**: Ensure the agent receives clear guidelines via the system prompt and tool description.

**Independent Test**: Verify that the system prompt contains the `PLANNING_POLICY` and the tool description is concise.

### Implementation for User Story 2

- [X] T008 [US2] Refine `EnterPlanMode` tool description in `packages/agent-sdk/src/tools/enterPlanMode.ts` for conciseness
- [X] T009 [US2] Verify `PLANNING_POLICY` injection logic in `packages/agent-sdk/src/constants/prompts.ts` via unit tests

**Checkpoint**: User Story 2 is complete; agent has full guidance on tool usage.

---

## Phase 5: User Story 3 - Exploration and Design in Plan Mode (Priority: P3)

**Goal**: Ensure the agent can perform exploration tasks while in plan mode.

**Independent Test**: Enter plan mode and verify that `Explore` tool and `Read` tool are functional while write operations are restricted.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T010 [P] [US3] Integration test for exploration tools in plan mode in `packages/code/tests/integration/enterPlanMode.feature.test.ts`

### Implementation for User Story 3

- [X] T011 [US3] Verify `PermissionManager` correctly enforces read-only restrictions in `packages/agent-sdk/src/managers/permissionManager.ts` during plan mode

**Checkpoint**: User Story 3 is complete; agent can safely explore and design in plan mode.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T012 [P] Run `pnpm run type-check` and `pnpm run lint` across the monorepo
- [X] T013 [P] Run `pnpm test:coverage` and ensure coverage is maintained or improved
- [X] T014 [P] Validate `quickstart.md` instructions against the final implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1.
- **User Stories (Phase 3+)**: Depend on Phase 2.
- **Polish (Final Phase)**: Depends on all user stories.

### User Story Dependencies

- **User Story 1 (P1)**: Foundation for all other stories.
- **User Story 2 (P2)**: Enhances US1 with better guidance.
- **User Story 3 (P3)**: Verifies behavior of US1 state.

### Parallel Opportunities

- T001 and T002 can run in parallel.
- T004 and T005 can run in parallel.
- T012, T013, and T014 can run in parallel.

---

## Implementation Strategy

### Task Delegation (CRITICAL)
- Use `typescript-expert` for T001, T002, T003, T006, T007, T008, T011.
- Use `vitest-expert` for T004, T005, T009, T010, T013.

### MVP First (User Story 1 Only)
1. Complete Phase 1 & 2.
2. Complete Phase 3 (US1).
3. Validate US1 independently.
