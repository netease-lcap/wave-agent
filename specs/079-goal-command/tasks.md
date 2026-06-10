# Tasks: /goal Command

**Input**: Design documents from `/specs/079-goal-command/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create `GoalState` interface and `GoalManager` class in `packages/agent-sdk/src/managers/goalManager.ts` (per data-model.md and contracts/GoalManager.md)
- [X] T002 [P] Create goal evaluator system prompt in `packages/agent-sdk/src/constants/goalPrompts.ts`
- [X] T003 [P] Add `"goal_evaluation"` to `operation_type` union in `packages/agent-sdk/src/types/core.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement `evaluateGoal()` function in `packages/agent-sdk/src/services/aiService.ts` (per contracts/evaluateGoal.md) — lightweight, no rate limiter, non-streaming
- [X] T005 Register `GoalManager` in DI container in `packages/agent-sdk/src/utils/containerSetup.ts`
- [X] T006 Expose `goalManager`, `isGoalActive`, `goalStatus` in `packages/agent-sdk/src/agent.ts`; wire `onGoalStateChange` callback
- [X] T007 Add `onGoalStateChange` to `AgentCallbacks` in `packages/agent-sdk/src/types/agent.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Set an autonomous goal (Priority: P1) 🎯 MVP

**Goal**: Allow users to set an autonomous goal condition that the agent works toward across turns.

**Independent Test**: Run `/goal all tests in test/auth pass` and verify autonomous loop starts.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T010 [P] [US1] Unit tests for GoalManager in `packages/agent-sdk/tests/goalManager.test.ts` — setGoal, clearGoal, circuit breakers, evaluateGoal, parseEvaluationResponse

### Implementation for User Story 1

- [X] T011 [US1] Add `/goal` command handler in `packages/agent-sdk/src/managers/slashCommandManager.ts` — set/status/clear sub-commands
- [X] T012 [US1] Implement goal evaluation in `packages/agent-sdk/src/managers/aiManager.ts` finally block — goal supersedes Stop hooks, notification drain, circuit breakers, loading state fix

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 & 3 - Check status & Clear goal (Priority: P2)

**Goal**: Allow users to check goal status and cancel active goals.

- [X] T013 [US2] Implement `/goal` status display in slash command handler (condition, elapsed, turns, last reason)
- [X] T014 [US3] Implement `/goal clear|stop|off|reset|none|cancel` aliases in slash command handler
- [X] T015 [US3] Add `goalManager.clearGoal()` to `/clear` handler in slash command handler

---

## Phase 5: UI & Session Persistence

**Purpose**: Visual feedback and session continuity

- [X] T016 [P] Add goal indicator `◎ /goal active (<elapsed>)` to `packages/code/src/components/StatusLine.tsx`
- [X] T017 [P] Thread goal props through `InputBox.tsx` → `ChatInterface.tsx` → `useChat.tsx`
- [X] T018 [P] Add `onGoalStateChange` callback wiring in `packages/code/src/contexts/useChat.tsx`
- [X] T019 (Removed — session persistence for goal removed)
- [X] T020 (Removed — session persistence for goal removed)
- [X] T021 [P] Create example script `packages/agent-sdk/examples/goal-demo.ts`

---

## Phase 6: Verification

- [X] T022 Run `pnpm -F wave-agent-sdk build && pnpm -F wave-code build` — Clean build
- [X] T023 Run `pnpm -F wave-agent-sdk test tests/goalManager.test.ts` — Unit tests pass
- [X] T024 Run `pnpm run type-check` — No type errors
- [X] T025 Run `pnpm -F wave-agent-sdk test` — All existing tests still pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-4)**: All depend on Foundational phase completion
- **UI & Session (Phase 5)**: Depends on Foundational phase completion
- **Verification (Phase 6)**: Depends on all phases being complete

### Parallel Opportunities

- T002 and T003 can run in parallel (different files, no dependencies)
- T010 can be written alongside T011/T012
- T016, T017, T018 can run in parallel (different files)
- T019 and T020 are sequential (T020 depends on T019's type changes)

---

## Implementation Strategy

### Task Delegation (CRITICAL)
Tasks in this file MUST be delegated to subagents whenever possible to reduce context costs of the main agent.
- Use `Explore` for codebase research.

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Stories 2 & 3 → Test independently
4. Add UI & Session persistence → Test end-to-end
