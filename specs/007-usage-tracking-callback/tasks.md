# Tasks: SDK Usage Tracking and Callback System

**Input**: Design documents from `/specs/007-usage-tracking-callback/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification, but may be included for critical functionality.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create Usage interface extension in packages/agent-sdk/src/types.ts
- [x] T002 [P] Extend AgentCallbacks interface with onUsagesChange in packages/agent-sdk/src/types.ts
- [x] T003 [P] Extend Message interface with usage field in packages/agent-sdk/src/types.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Add Agent._usages private array field in packages/agent-sdk/src/agent.ts
- [x] T005 Add Agent.usages public getter method in packages/agent-sdk/src/agent.ts
- [x] T006 [P] Update messageOperations to support usage parameter in packages/agent-sdk/src/utils/messageOperations.ts
- [x] T007 [P] Create usage summary utility in packages/code/src/utils/usageSummary.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Real-time Usage Monitoring (Priority: P1) 🎯 MVP

**Goal**: Enable real-time usage monitoring through callbacks for agent calls and compression operations

**Independent Test**: Register callback, make agent call, verify callback receives accurate usage data

### Implementation for User Story 1

- [x] T008 [US1] Implement usage tracking in AIManager.callAgent() in packages/agent-sdk/src/managers/aiManager.ts
- [x] T009 [US1] Implement usage tracking in AIManager.compressMessages() in packages/agent-sdk/src/managers/aiManager.ts
- [x] T010 [US1] Add usage callback triggering logic in MessageManager in packages/agent-sdk/src/managers/messageManager.ts
- [x] T011 [US1] Add error handling for callback failures in packages/agent-sdk/src/managers/messageManager.ts
- [x] T012 [US1] Update Agent constructor to pass callbacks to managers in packages/agent-sdk/src/agent.ts
- [x] T012b [US1] Add usage tracking callback support in SubAgent operations in packages/agent-sdk/src/managers/subagentManager.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Usage Data Retrieval (Priority: P2)

**Goal**: Provide programmatic access to usage statistics via public getter method

**Independent Test**: Make several agent calls, call agent.usages getter, verify accurate cumulative statistics

### Implementation for User Story 2

- [x] T013 [US2] Implement addUsage private method in Agent class in packages/agent-sdk/src/agent.ts
- [x] T014 [US2] Update AIManager to call Agent.addUsage after successful operations in packages/agent-sdk/src/managers/aiManager.ts
- [x] T015 [US2] Add session restoration logic to rebuild _usages array from messages in packages/agent-sdk/src/agent.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 4 - CLI Exit Token Summary (Priority: P2)

**Goal**: Display token usage summary by model when CLI exits

**Independent Test**: Run CLI with different models, verify exit summary shows accurate totals

### Implementation for User Story 4

- [x] T016 [P] [US4] Implement calculateTokenSummary function in packages/code/src/utils/usageSummary.ts
- [x] T017 [P] [US4] Implement displayUsageSummary function in packages/code/src/utils/usageSummary.ts
- [x] T018 [US4] Add usage summary to cleanup function in packages/code/src/cli.tsx
- [x] T019 [US4] Add usage summary to cleanup function in packages/code/src/plain-cli.ts

**Checkpoint**: CLI exit summaries should work for both interactive and plain modes

---

## Phase 6: User Story 3 - Message-Level Usage Recording (Priority: P3)

**Goal**: Embed usage data within assistant messages for detailed analytics and session persistence

**Independent Test**: Perform agent operations, examine session messages to verify usage metadata attachment

### Implementation for User Story 3

- [x] T020 [US3] Update addAssistantMessageToMessages to accept usage parameter in packages/agent-sdk/src/utils/messageOperations.ts
- [x] T021 [US3] Modify AIManager to pass usage data when creating assistant messages in packages/agent-sdk/src/managers/aiManager.ts
- [x] T022 [US3] Update session save logic to persist usage data in messages in packages/agent-sdk/src/services/session.ts
- [x] T023 [US3] Update session load logic to extract usage data from messages in packages/agent-sdk/src/agent.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 7: Testing & Validation (Optional)

**Purpose**: Ensure quality and correctness of implemented features

- [x] T024 [P] Create usage tracking integration test in packages/agent-sdk/tests/agent/agent.usages.test.ts
- [x] T025 [P] Create callback system test in packages/agent-sdk/tests/managers/messageManager.test.ts
- [x] T026 [P] Create CLI summary test in packages/code/tests/utils/usageSummary.test.ts
- [x] T027 [P] Create session persistence test in packages/agent-sdk/tests/services/sessionService.test.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P2 → P3)
- **Testing (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Depends on US2 for usages data access
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Core implementation before integration
- Agent changes before Manager changes
- Manager changes before CLI changes
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, User Stories 1, 2, and 3 can start in parallel (US4 needs US2)
- All tests marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# No parallel tasks within User Story 1 due to dependencies:
# All tasks must run sequentially as they modify related manager classes
```

---

## Parallel Example: User Story 4

```bash
# Launch implementation tasks for User Story 4 together:
Task: "Implement calculateTokenSummary function in packages/code/src/utils/usageSummary.ts"
Task: "Implement displayUsageSummary function in packages/code/src/utils/usageSummary.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Real-time Usage Monitoring)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 4 → Test independently → Deploy/Demo
5. Add User Story 3 → Test independently → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Real-time monitoring)
   - Developer B: User Story 2 (Usage retrieval)
   - Developer C: User Story 3 (Message recording)
3. User Story 4 can start after User Story 2 completes
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Build agent-sdk package before testing in code package (standard workflow)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on callback system reuse and OpenAI Usage format consistency