# Tasks: General-Purpose Agent

**Input**: Design documents from `/specs/058-general-purpose-agent/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project structure per implementation plan
- [x] T002 [P] Create functional example skeleton in packages/agent-sdk/examples/general-purpose-agent.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Define system prompt constant for general-purpose agent in packages/agent-sdk/src/constants/prompts.ts
- [x] T004 [P] Update SubagentConfiguration type if necessary in packages/agent-sdk/src/utils/subagentParser.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Accessing the General-Purpose Subagent (Priority: P1) 🎯 MVP

**Goal**: Register the general-purpose agent so it can be discovered and invoked via the Task tool.

**Independent Test**: Verify "general-purpose" is returned by `getBuiltinSubagents()` and can be retrieved by `findSubagentByName()`.

### Tests for User Story 1 (REQUIRED) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T005 [P] [US1] Unit test for general-purpose agent registration in packages/agent-sdk/tests/utils/builtinSubagents.test.ts
- [ ] T006 [P] [US1] Integration test for Task tool delegation to general-purpose agent in packages/agent-sdk/tests/integration/taskTool.builtin.test.ts

### Implementation for User Story 1

- [ ] T007 [US1] Implement `createGeneralPurposeSubagent` function in packages/agent-sdk/src/utils/builtinSubagents.ts
- [ ] T008 [US1] Register general-purpose agent in `getBuiltinSubagents` array in packages/agent-sdk/src/utils/builtinSubagents.ts
- [ ] T009 [US1] Verify Task tool can resolve "general-purpose" subagent type

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Consistent Subagent Behavior (Priority: P2)

**Goal**: Ensure the subagent follows the specific guidelines (absolute paths, no emojis, no proactive docs) and has full tool access.

**Independent Test**: Run the functional example and verify the subagent's output format and tool usage.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T010 [P] [US2] Add behavior validation tests in packages/agent-sdk/tests/utils/builtinSubagents.test.ts
- [ ] T011 [P] [US2] Create real-world functional test in packages/agent-sdk/examples/general-purpose-agent.ts

### Implementation for User Story 2

- [ ] T012 [US2] Refine system prompt in packages/agent-sdk/src/constants/prompts.ts to include all operational guidelines
- [ ] T013 [US2] Ensure `tools` field is omitted in the configuration in packages/agent-sdk/src/utils/builtinSubagents.ts
- [ ] T014 [US2] Validate `scope: "builtin"` and `filePath: "<builtin:general-purpose>"` settings

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T015 [P] Run `pnpm build` in packages/agent-sdk
- [ ] T016 [P] Run `pnpm run type-check` and `pnpm lint` across the workspace
- [ ] T017 [P] Final validation using quickstart.md scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories.
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 registration to be fully testable.

### Parallel Opportunities

- T002, T004 can run in parallel.
- T005, T006 can run in parallel.
- T010, T011 can run in parallel.
- T015, T016, T017 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit test for general-purpose agent registration in packages/agent-sdk/tests/utils/builtinSubagents.test.ts"
Task: "Integration test for Task tool delegation to general-purpose agent in packages/agent-sdk/tests/integration/taskTool.builtin.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Verify subagent registration and basic Task tool delegation.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Each story adds value without breaking previous stories.
