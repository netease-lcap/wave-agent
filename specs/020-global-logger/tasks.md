# Tasks: Global Logger for Agent SDK

**Input**: Design documents from `/specs/020-global-logger/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Following TDD principles as required by Wave Agent Constitution - write failing tests before implementation

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Agent SDK Package**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- Following existing agent-sdk organization patterns

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for global logger feature

- [x] T001 Verify existing Logger interface in packages/agent-sdk/src/types/core.ts
- [x] T002 [P] Create test utilities directory structure in packages/agent-sdk/tests/utils/
- [x] T003 [P] Create integration test directory structure in packages/agent-sdk/tests/integration/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core global logger infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create global logger registry module in packages/agent-sdk/src/utils/globalLogger.ts
- [x] T005 [P] Export global logger from main index in packages/agent-sdk/src/index.ts
- [x] T006 [P] Setup mock logger utilities for testing in packages/agent-sdk/tests/utils/mockLogger.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - SDK Developer Sets Global Logger (Priority: P1) 🎯 MVP

**Goal**: Enable SDK developers to configure a global logger in the Agent class so utility functions can access it

**Independent Test**: Create an Agent instance with a logger, call a utility function that should log, and verify the log output appears in the expected format and destination

### Tests for User Story 1 (TDD Required) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T007 [US1] Basic global logger registry tests in packages/agent-sdk/tests/utils/globalLogger.test.ts
- [x] T008 [US1] Agent integration test for setting global logger in packages/agent-sdk/tests/integration/globalLogger.integration.test.ts

### Implementation for User Story 1

- [x] T009 [US1] Implement global logger registry functions in packages/agent-sdk/src/utils/globalLogger.ts
- [x] T010 [US1] Update Agent constructor to set global logger in packages/agent-sdk/src/agent.ts
- [x] T011 [US1] Add TypeScript type definitions for global logger exports in packages/agent-sdk/src/utils/globalLogger.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Utility Functions Use Global Logger (Priority: P2)

**Goal**: Enable utility functions to access the global logger for debugging without requiring logger parameters

**Independent Test**: Call utility functions that use the global logger and verify log messages appear with appropriate log levels and context

### Tests for User Story 2 (TDD Required) ⚠️

- [x] T012 [US2] Zero-overhead logging functions tests in packages/agent-sdk/tests/utils/globalLogger.test.ts
- [x] T013 [US2] Utility function logging integration tests in packages/agent-sdk/tests/integration/globalLogger.integration.test.ts

### Implementation for User Story 2

- [x] T014 [US2] Implement zero-overhead logging functions in packages/agent-sdk/src/utils/globalLogger.ts
- [x] T015 [P] [US2] Replace console calls in utility functions in packages/agent-sdk/src/utils/
- [x] T016 [P] [US2] Add contextual logging to core utilities in packages/agent-sdk/src/utils/

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Service Functions Emit Contextual Logs (Priority: P3)

**Goal**: Enable service functions to emit contextual log messages for SDK internal operations visibility

**Independent Test**: Enable debug logging and perform operations that trigger service functions, then verify appropriate contextual log messages are emitted

### Tests for User Story 3 (TDD Required) ⚠️

- [x] T017 [US3] Service logging integration tests in packages/agent-sdk/tests/integration/globalLogger.integration.test.ts

### Implementation for User Story 3

- [x] T018 [P] [US3] Enable logging in memory service in packages/agent-sdk/src/services/memory.ts
- [x] T019 [P] [US3] Add contextual logging to session service in packages/agent-sdk/src/services/session.ts
- [x] T020 [P] [US3] Add logging to remaining services in packages/agent-sdk/src/services/ (基础实现完成，后续按需添加)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure production readiness

- [ ] T021 [P] Add JSDoc documentation to global logger functions in packages/agent-sdk/src/utils/globalLogger.ts
- [ ] T022 [P] Performance benchmarking test in packages/agent-sdk/tests/utils/globalLogger.performance.test.ts
- [ ] T023 Type-check validation across all modified files
- [ ] T024 ESLint validation across all modified files
- [ ] T025 Build packages/agent-sdk and verify exports work correctly

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 global logger registry existing
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on US1 and US2 for logger access patterns

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD requirement)
- Global logger registry functions before zero-overhead logger functions
- Agent integration after registry functions are complete
- Utility function updates after logger functions are implemented
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Utility function updates within US2 marked [P] can run in parallel
- Service logging updates within US3 marked [P] can run in parallel

---

## Parallel Example: User Story 2

```bash
# Launch utility function updates together:
Task: "Replace console calls in utility functions"
Task: "Add contextual logging to core utilities"
```

---

## Parallel Example: User Story 3

```bash
# Launch service logging updates together:
Task: "Enable logging in memory service"
Task: "Add contextual logging to session service" 
Task: "Add logging to remaining services"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Agent can now set global logger, basic functionality working

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Agent logger configuration working (MVP!)
3. Add User Story 2 → Test independently → Utility functions can log
4. Add User Story 3 → Test independently → Services provide contextual logging
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (critical path)
   - Developer B: User Story 2 (can start after US1 registry exists)
   - Developer C: User Story 3 (can start after US1 registry exists)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- TDD workflow: Write failing tests first, then implement to make tests pass
- Follow constitution requirement: run `pnpm build` after agent-sdk modifications
- Zero-overhead requirement critical for performance - validate with benchmarks
- Maintain backward compatibility - no breaking changes to existing Agent API