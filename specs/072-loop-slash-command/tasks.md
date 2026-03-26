# Tasks: /loop Slash Command

**Input**: Design documents from `/specs/072-loop-slash-command/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create project structure per implementation plan in `packages/agent-sdk/src/builtin-skills/loop/`
- [X] T002 [P] Install `cron-parser` dependency in `packages/agent-sdk/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Create `CronJob` type definition in `packages/agent-sdk/src/types/cron.ts` (per data-model.md)
- [X] T004 Implement `CronManager` class with in-memory store and idle-check logic in `packages/agent-sdk/src/managers/cronManager.ts`
- [X] T005 Implement `CronCreate` tool logic in `packages/agent-sdk/src/tools/cronCreateTool.ts` (interacts with `CronManager`)
- [X] T006 Implement `CronDelete` tool logic in `packages/agent-sdk/src/tools/cronDeleteTool.ts` (interacts with `CronManager`)
- [X] T007 Implement `CronList` tool logic in `packages/agent-sdk/src/tools/cronListTool.ts` (interacts with `CronManager`)
- [X] T008 Register `CronManager` and tools in `packages/agent-sdk/src/index.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Schedule a recurring task with explicit interval (Priority: P1) 🎯 MVP

**Goal**: Allow users to schedule a command or prompt with an explicit interval (e.g., `5m`, `every 2h`) and execute it immediately.

**Independent Test**: Run `/loop 5m /echo "hello"` and verify the task is scheduled and "hello" is printed immediately.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T010 [P] [US1] Integration test for `/loop` command execution in `packages/agent-sdk/tests/builtin-skills/loop/execution.test.ts`

### Implementation for User Story 1

- [X] T011 [US1] Create `/loop` skill definition in `packages/agent-sdk/src/builtin-skills/loop/SKILL.md`
- [X] T013 [US1] Implement immediate execution logic using `aiManager.sendAIMessage()` in `packages/agent-sdk/src/builtin-skills/loop/SKILL.md`
- [X] T014 [US1] Implement confirmation message with Job ID and natural language cancellation instructions in `packages/agent-sdk/src/builtin-skills/loop/SKILL.md`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T019 [P] Implement thundering herd prevention (random minute for approximate requests) in `packages/agent-sdk/src/builtin-skills/loop/SKILL.md`
- [X] T020 [P] Implement 7-day auto-expiration check in `packages/agent-sdk/src/managers/cronManager.ts`
- [X] T021 [P] Implement deterministic jitter for recurring and one-shot tasks in `packages/agent-sdk/src/managers/cronManager.ts`
- [X] T022 [P] Verify `pnpm test:coverage` passes for all new components
- [X] T023 Run `quickstart.md` validation to ensure user-facing instructions are accurate

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 parsing structure
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on US1 parsing structure

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit test for interval parsing logic in packages/agent-sdk/tests/builtin-skills/loop/parsing.test.ts"
Task: "Integration test for /loop command execution in packages/agent-sdk/tests/builtin-skills/loop/execution.test.ts"
```

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
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
