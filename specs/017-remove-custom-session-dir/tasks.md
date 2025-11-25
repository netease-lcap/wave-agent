# Tasks: Remove Custom Session Dir Feature

**Input**: Design documents from `/specs/017-remove-custom-session-dir/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification. TDD approach used for verification only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo package**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- Code changes focused on agent-sdk package with potential minor updates to code package

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project preparation and validation of current state

- [X] T001 Run TypeScript type-check to establish baseline in packages/agent-sdk
- [X] T002 [P] Run test suite to establish baseline coverage in packages/agent-sdk
- [X] T003 [P] Audit current sessionDir usage throughout codebase to confirm research findings

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core foundation changes that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Build current agent-sdk package to ensure clean build state with pnpm build
- [X] T005 Create backup branch of current functionality for rollback safety
- [X] T006 Validate that SESSION_DIR constant exists and is properly defined in packages/agent-sdk/src/services/session.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Clean API Simplification (Priority: P1) 🎯 MVP

**Goal**: Remove sessionDir parameter from all Agent SDK interfaces, forcing usage of default session directory only

**Independent Test**: Can be fully tested by creating an Agent and verifying that sessions are stored only in the default location (~/.wave/projects) with no sessionDir-related code paths.

### Implementation for User Story 1

- [X] T007 [P] [US1] Remove sessionDir parameter from appendMessages function in packages/agent-sdk/src/services/session.ts
- [X] T008 [P] [US1] Remove sessionDir parameter from loadSessionFromJsonl function in packages/agent-sdk/src/services/session.ts
- [X] T009 [P] [US1] Remove sessionDir parameter from getSessionFilePath function in packages/agent-sdk/src/services/session.ts
- [X] T010 [P] [US1] Remove sessionDir parameter from getLatestSessionFromJsonl function in packages/agent-sdk/src/services/session.ts
- [X] T011 [P] [US1] Remove sessionDir parameter from listSessionsFromJsonl function in packages/agent-sdk/src/services/session.ts
- [X] T012 [P] [US1] Remove sessionDir parameter from deleteSessionFromJsonl function in packages/agent-sdk/src/services/session.ts
- [X] T013 [P] [US1] Remove sessionDir parameter from sessionExistsInJsonl function in packages/agent-sdk/src/services/session.ts
- [X] T014 [P] [US1] Remove sessionDir parameter from cleanupExpiredSessionsFromJsonl function in packages/agent-sdk/src/services/session.ts
- [X] T015 [P] [US1] Remove sessionDir parameter from ensureSessionDir function in packages/agent-sdk/src/services/session.ts
- [X] T016 [US1] Eliminate resolveSessionDir function entirely from packages/agent-sdk/src/services/session.ts
- [X] T017 [US1] Replace all resolveSessionDir() calls with SESSION_DIR constant in packages/agent-sdk/src/services/session.ts
- [X] T018 [US1] Remove sessionDir from MessageManagerOptions interface in packages/agent-sdk/src/managers/messageManager.ts
- [X] T019 [US1] Remove sessionDir property from MessageManager class in packages/agent-sdk/src/managers/messageManager.ts
- [X] T020 [US1] Update MessageManager constructor to not handle sessionDir parameter in packages/agent-sdk/src/managers/messageManager.ts
- [X] T021 [US1] Update computeTranscriptPath method to use SESSION_DIR directly in packages/agent-sdk/src/managers/messageManager.ts
- [X] T022 [US1] Update all session service calls in MessageManager to remove sessionDir parameter in packages/agent-sdk/src/managers/messageManager.ts
- [X] T023 [US1] Remove sessionDir from AgentOptions interface in packages/agent-sdk/src/agent.ts
- [X] T024 [US1] Remove sessionDir extraction from Agent constructor in packages/agent-sdk/src/agent.ts
- [X] T025 [US1] Remove sessionDir parameter when creating MessageManager in packages/agent-sdk/src/agent.ts
- [X] T026 [US1] Remove sessionDir from session type interfaces in packages/agent-sdk/src/types/session.ts

**Checkpoint**: At this point, User Story 1 should be fully functional with sessionDir completely removed from all APIs

---

## Phase 4: User Story 2 - Removed Configuration Complexity (Priority: P2)

**Goal**: Update all test files to remove sessionDir-related testing scenarios while maintaining coverage of default behavior

**Independent Test**: Can be fully tested by reviewing the codebase and verifying no sessionDir parameters exist in any public APIs or internal functions.

### Implementation for User Story 2

- [X] T027 [P] [US2] Update session service tests to remove sessionDir parameters in packages/agent-sdk/tests/services/session.test.ts
- [X] T028 [P] [US2] Remove sessionDir-specific test cases from session tests in packages/agent-sdk/tests/services/session.test.ts
- [X] T029 [P] [US2] Update session service mocks to remove sessionDir parameters in packages/agent-sdk/tests/services/session.test.ts
- [X] T030 [P] [US2] Update MessageManager tests to remove sessionDir usage in packages/agent-sdk/tests/managers/messageManager*.test.ts
- [X] T031 [P] [US2] Remove sessionDir from MessageManager constructor tests in packages/agent-sdk/tests/managers/messageManager*.test.ts
- [X] T032 [P] [US2] Update MessageManager mocks to remove sessionDir parameters in packages/agent-sdk/tests/managers/messageManager*.test.ts
- [X] T033 [P] [US2] Update Agent tests to remove sessionDir from Agent.create() calls in packages/agent-sdk/tests/agent/*.test.ts
- [X] T034 [P] [US2] Remove sessionDir-specific test scenarios from Agent tests in packages/agent-sdk/tests/agent/*.test.ts
- [X] T035 [P] [US2] Update Agent creation mocks to remove sessionDir parameters in packages/agent-sdk/tests/agent/*.test.ts
- [X] T036 [P] [US2] Update SubagentManager tests if using sessionDir in packages/agent-sdk/tests/managers/subagentManager*.test.ts
- [X] T037 [P] [US2] Update any path encoder tests related to sessionDir in packages/agent-sdk/tests/utils/pathEncoder.test.ts
- [X] T038 [US2] Add tests verifying default directory behavior is preserved across all session operations
- [X] T039 [US2] Add tests verifying TypeScript compilation fails when attempting to use sessionDir parameter

**Checkpoint**: At this point, all tests should pass without sessionDir-related configuration or mocking

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validation, cleanup and ensuring breaking change is properly implemented

- [X] T040 [P] Run complete TypeScript type-check to verify no sessionDir usage remains in packages/agent-sdk
- [X] T041 [P] Run complete test suite to ensure all functionality preserved in packages/agent-sdk
- [X] T042 [P] Run linting to ensure code quality standards maintained in packages/agent-sdk
- [X] T043 Build agent-sdk package to ensure clean build with pnpm build in packages/agent-sdk
- [X] T044 [P] Test in dependent code package to verify no breaking changes to existing functionality in packages/code
- [X] T045 [P] Validate that sessions are created exclusively in ~/.wave/projects using quickstart.md scenarios
- [X] T046 Create example demonstrating TypeScript compilation error when attempting to use sessionDir parameter
- [X] T047 Verify that all success criteria from spec.md are met through comprehensive testing

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Final Phase)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 completion - Tests need updated interfaces to verify against

### Within Each User Story

- Session service function updates before MessageManager updates
- MessageManager updates before Agent interface updates
- Core implementation before test updates
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- All session service function updates marked [P] can run in parallel within US1
- All test file updates marked [P] can run in parallel within US2
- All validation tasks marked [P] can run in parallel in Polish phase

---

## Parallel Example: User Story 1

```bash
# Launch all session service function updates together:
Task: "Remove sessionDir parameter from appendMessages function in packages/agent-sdk/src/services/session.ts"
Task: "Remove sessionDir parameter from loadSessionFromJsonl function in packages/agent-sdk/src/services/session.ts"
Task: "Remove sessionDir parameter from getSessionFilePath function in packages/agent-sdk/src/services/session.ts"
# ... and other session service function updates

# Then launch MessageManager updates:
Task: "Remove sessionDir from MessageManagerOptions interface in packages/agent-sdk/src/managers/messageManager.ts"
Task: "Remove sessionDir property from MessageManager class in packages/agent-sdk/src/managers/messageManager.ts"
# ... and other MessageManager updates
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - validates current state)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test that sessionDir is completely removed from APIs
5. Verify compilation errors when attempting to use sessionDir

### Incremental Delivery

1. Complete Setup + Foundational → Baseline established
2. Add User Story 1 → Test independently → sessionDir removed from all APIs
3. Add User Story 2 → Test independently → All tests updated and passing
4. Complete Polish → Full validation and cleanup

### Breaking Change Strategy

This is an intentional breaking change:

1. TypeScript compilation will fail for users currently using sessionDir parameter
2. This provides clear migration path - users must remove sessionDir from their code
3. Default behavior (~/.wave/projects) remains unchanged for users not using custom sessionDir
4. All functionality preserved except custom session directory configuration

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- This is a feature REMOVAL, so focus is on eliminating code rather than adding
- Breaking change is intentional - TypeScript errors guide user migration
- Default session directory behavior must be preserved throughout
- Run `pnpm build` after modifying agent-sdk before testing in dependent packages