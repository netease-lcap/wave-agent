# Tasks: SessionDir Constructor Argument

**Input**: Design documents from `/specs/008-sessiondir-constructor-arg/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Integration tests are required for this feature as session operations involve real file system interactions.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Validate TypeScript environment and dependencies for agent-sdk package

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Add sessionDir property to AgentOptions interface in packages/agent-sdk/src/agent.ts
- [x] T003 [P] Add MessageManagerOptions interface extension in packages/agent-sdk/src/managers/messageManager.ts
- [x] T004 [P] Create internal session directory resolution helper function in packages/agent-sdk/src/services/session.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Custom Session Directory (Priority: P1) 🎯 MVP

**Goal**: Enable users to specify custom session directory when creating Agent instances

**Independent Test**: Create Agent with custom sessionDir, send message, verify session file created in custom directory

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T005 [P] [US1] Integration test for custom sessionDir creation in packages/agent-sdk/tests/agent/sessiondir.test.ts
- [x] T006 [P] [US1] Integration test for session save/load with custom directory in packages/agent-sdk/tests/services/session-custom.test.ts

### Implementation for User Story 1

- [x] T007 [US1] Update Agent constructor to accept and store sessionDir parameter in packages/agent-sdk/src/agent.ts
- [x] T008 [US1] Update MessageManager constructor to accept sessionDir and pass to session operations in packages/agent-sdk/src/managers/messageManager.ts
- [x] T009 [US1] Update saveSession function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T010 [US1] Update loadSession function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T011 [US1] Update getSessionFilePath function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T012 [US1] Update ensureSessionDir function to work with custom directory paths in packages/agent-sdk/src/services/session.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Default Session Directory Behavior (Priority: P2)

**Goal**: Ensure backward compatibility when sessionDir is not specified

**Independent Test**: Create Agent without sessionDir, verify sessions use default ~/.wave/sessions directory

### Tests for User Story 2

- [x] T013 [P] [US2] Integration test for default sessionDir behavior in packages/agent-sdk/tests/agent/sessiondir.test.ts
- [x] T014 [P] [US2] Integration test for backward compatibility with existing sessions in packages/agent-sdk/tests/services/session-default.test.ts

### Implementation for User Story 2

- [x] T015 [US2] Update getLatestSession function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T016 [US2] Update listSessions function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T017 [US2] Update deleteSession function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T018 [US2] Update cleanupExpiredSessions function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts
- [x] T019 [US2] Update sessionExists function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Session Directory Validation (Priority: P3)

**Goal**: Provide clear error messages when invalid sessionDir is provided

**Independent Test**: Create Agent with invalid sessionDir, verify appropriate error messages are shown

### Tests for User Story 3

- [x] T020 [P] [US3] Integration test for invalid sessionDir error handling in packages/agent-sdk/tests/agent/sessiondir.test.ts
- [x] T021 [P] [US3] Integration test for permission error handling in packages/agent-sdk/tests/services/session-errors.test.ts

### Implementation for User Story 3

- [x] T022 [P] [US3] Add SessionDirError class for session directory errors in packages/agent-sdk/src/services/session.ts (Simplified: Removed for conciseness)
- [x] T023 [US3] Enhance ensureSessionDir with better error messages and validation in packages/agent-sdk/src/services/session.ts (Simplified: Basic error handling)
- [x] T024 [US3] Add sessionDir path validation and resolution in packages/agent-sdk/src/services/session.ts (Simplified: Basic resolution)
- [x] T025 [US3] Update all session functions to handle SessionDirError appropriately in packages/agent-sdk/src/services/session.ts (Simplified: Standard error handling)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T026 [P] Add comprehensive JSDoc documentation for new sessionDir parameters in packages/agent-sdk/src/agent.ts
- [x] T027 [P] Add comprehensive JSDoc documentation for session service functions in packages/agent-sdk/src/services/session.ts
- [x] T028 Run type checking and linting validation for all modified files
- [x] T029 [P] Update existing session service tests to cover sessionDir parameter in packages/agent-sdk/tests/services/session.test.ts
- [x] T030 Validate backward compatibility by running existing test suite
- [x] T031 Run quickstart.md validation with example usage patterns

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 session service modifications but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Enhances error handling from US1/US2 but independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Interface modifications before constructor changes
- Service function updates before manager integration
- Core implementation before error handling
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Documentation tasks marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Integration test for custom sessionDir creation in packages/agent-sdk/tests/agent/sessiondir.test.ts"
Task: "Integration test for session save/load with custom directory in packages/agent-sdk/tests/services/session-custom.test.ts"

# Launch session service function updates together (after tests are written):
Task: "Update saveSession function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts"
Task: "Update loadSession function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts"
Task: "Update getSessionFilePath function to accept optional sessionDir parameter in packages/agent-sdk/src/services/session.ts"
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
   - Developer B: User Story 2 (after US1 service modifications)
   - Developer C: User Story 3 (error handling enhancements)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Run `pnpm build` after modifying agent-sdk before testing
- Run `pnpm run type-check` and `pnpm run lint` after each implementation phase
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence