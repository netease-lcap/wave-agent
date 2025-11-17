# Tasks: Hook Exit Code Output Support

**Input**: Design documents from `/specs/011-hooks-exitcode-output/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create enhanced message manager method in packages/agent-sdk/src/managers/messageManager.ts
- [ ] T002 Create utility function in packages/agent-sdk/src/utils/messageOperations.ts
- [ ] T003 [P] Create test directory structure in packages/agent-sdk/tests/agent/hooks-exitcode-output/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Implement removeLastUserMessage() method in packages/agent-sdk/src/managers/messageManager.ts
- [ ] T005 [P] Implement removeLastUserMessage() utility function in packages/agent-sdk/src/utils/messageOperations.ts
- [ ] T006 [P] Create hook output processing logic base structure in packages/agent-sdk/src/managers/hookManager.ts
- [ ] T007 Setup test mocking infrastructure in packages/agent-sdk/tests/agent/hooks-exitcode-output/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Hook Success Feedback (Priority: P1) 🎯 MVP

**Goal**: Enable hooks to provide successful execution feedback with appropriate context handling for UserPromptSubmit and other hook types

**Independent Test**: Execute hooks that return exit code 0 and verify stdout handling varies by hook type through agent.messages validation

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T008 [P] [US1] Create success behavior test file in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts
- [ ] T009 [P] [US1] Test UserPromptSubmit success with stdout injection in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts
- [ ] T010 [P] [US1] Test other hook types ignore stdout in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts

### Implementation for User Story 1

- [ ] T011 [P] [US1] Add UserPromptSubmit hook result processing in packages/agent-sdk/src/agent.ts
- [ ] T012 [P] [US1] Add PreToolUse hook result processing in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T013 [P] [US1] Add PostToolUse hook result processing in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T014 [P] [US1] Add Stop hook result processing in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T015 [US1] Implement exit code 0 handling logic in packages/agent-sdk/src/managers/hookManager.ts
- [ ] T016 [US1] Add hook success validation and error handling in packages/agent-sdk/src/agent.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Hook Blocking Error Handling (Priority: P1)

**Goal**: Enable hooks to block operations and provide error feedback to appropriate recipients based on hook event type

**Independent Test**: Execute hooks that return exit code 2 and verify different blocking behaviors per hook type through agent.messages validation

### Tests for User Story 2

- [ ] T017 [P] [US2] Create blocking error test file in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [ ] T018 [P] [US2] Test UserPromptSubmit blocking with prompt erasure in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [ ] T019 [P] [US2] Test PreToolUse tool blocking with agent feedback in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [ ] T020 [P] [US2] Test PostToolUse feedback without blocking in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [ ] T021 [P] [US2] Test Stop operation blocking with agent feedback in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts

### Implementation for User Story 2

- [ ] T022 [US2] Implement UserPromptSubmit exit code 2 blocking in packages/agent-sdk/src/agent.ts
- [ ] T023 [US2] Implement PreToolUse exit code 2 processing in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T024 [US2] Implement PostToolUse exit code 2 processing in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T025 [US2] Implement Stop exit code 2 processing with AI continuation in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T026 [US2] Add exit code 2 routing logic in packages/agent-sdk/src/managers/hookManager.ts
- [ ] T027 [US2] Integrate prompt erasure functionality in packages/agent-sdk/src/agent.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Hook Non-Blocking Error Reporting (Priority: P2)

**Goal**: Enable hooks to report non-critical errors that display to users while allowing continued execution

**Independent Test**: Execute hooks that return exit codes other than 0 or 2 and verify error display with continued execution

### Tests for User Story 3

- [ ] T028 [P] [US3] Create non-blocking error test file in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-non-blocking-errors.test.ts
- [ ] T029 [P] [US3] Test non-blocking errors show to user in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-non-blocking-errors.test.ts
- [ ] T030 [P] [US3] Test execution continues after non-blocking errors in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-non-blocking-errors.test.ts

### Implementation for User Story 3

- [ ] T031 [P] [US3] Add non-blocking error handling in packages/agent-sdk/src/agent.ts
- [ ] T032 [P] [US3] Add non-blocking error handling in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T033 [US3] Implement non-blocking exit code routing in packages/agent-sdk/src/managers/hookManager.ts
- [ ] T034 [US3] Add error display logic for all hook types in packages/agent-sdk/src/managers/hookManager.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T035 Run type check validation: pnpm run type-check
- [ ] T036 Run lint validation: pnpm run lint
- [ ] T037 Build agent-sdk package: pnpm build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories, but should integrate with US1 testing patterns
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories, uses patterns from US1/US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Hook processing logic before message operations
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Different hook type implementations within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Test UserPromptSubmit success with stdout injection in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts"
Task: "Test other hook types ignore stdout in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts"

# Launch all hook type implementations for User Story 1 together:
Task: "Add UserPromptSubmit hook result processing in packages/agent-sdk/src/agent.ts"
Task: "Add PreToolUse hook result processing in packages/agent-sdk/src/managers/aiManager.ts"
Task: "Add PostToolUse hook result processing in packages/agent-sdk/src/managers/aiManager.ts"
Task: "Add Stop hook result processing in packages/agent-sdk/src/managers/aiManager.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- All tests use comprehensive mocking to avoid real hook execution, file IO, or network operations
- Hook output processing must handle edge cases (empty output, large output, non-UTF-8 content)
- Performance target: Hook output processing within 200ms
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently