# Tasks: Session Management Improvements

**Input**: Design documents from `/specs/016-session-management-improvements/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included as this feature requires TDD approach per quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependency installation

- [X] T001 Install UUIDv6 dependency in packages/agent-sdk/package.json
- [X] T002 [P] Create pathEncoder utility structure in packages/agent-sdk/src/utils/pathEncoder.ts
- [X] T003 [P] Create jsonlHandler service structure in packages/agent-sdk/src/services/jsonlHandler.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Update session directory constants in packages/code/src/utils/constants.ts
- [X] T005 [P] Create session interface types in packages/agent-sdk/src/types/index.ts
- [X] T006 Build agent-sdk package after foundational changes using `pnpm build` in packages/agent-sdk/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Improved Session Organization (Priority: P1) 🎯 MVP

**Goal**: Session files organized by project directory so users can manage sessions per working directory without mixing between projects

**Independent Test**: Create sessions in different working directories and verify they are stored in separate subdirectories under ~/.wave/projects with proper project-based isolation

### Tests for User Story 1

**⚠️ TDD GATE: Write these tests FIRST, ensure they FAIL before implementation. Implementation tasks T010-T015 are BLOCKED until tests T007-T009, T046 are written and confirmed FAILING.**

- [X] T007 [P] [US1] Unit test for pathEncoder.encode() in packages/agent-sdk/tests/utils/pathEncoder.test.ts
- [X] T008 [P] [US1] Unit test for pathEncoder.createProjectDirectory() in packages/agent-sdk/tests/utils/pathEncoder.test.ts
- [X] T009 [P] [US1] Integration test for project directory creation in packages/agent-sdk/tests/services/session.test.ts
- [X] T046 [P] [FR-012] Unit test for message persistence during AI recursion in packages/agent-sdk/tests/managers/aiManager.test.ts

### Implementation for User Story 1

- [X] T010 [P] [US1] Implement PathEncoder.encode() method in packages/agent-sdk/src/utils/pathEncoder.ts
- [X] T011 [P] [US1] Implement PathEncoder.resolvePath() method in packages/agent-sdk/src/utils/pathEncoder.ts
- [X] T012 [US1] Implement PathEncoder.createProjectDirectory() method in packages/agent-sdk/src/utils/pathEncoder.ts (depends on T010, T011)
- [X] T013 [US1] Update session service to use project-based directory structure in packages/agent-sdk/src/services/session.ts
- [X] T014 [US1] Update ensureSessionDirectory() to create project subdirectories in packages/agent-sdk/src/services/session.ts
- [X] T015 [US1] Update session listing to filter by encoded working directory in packages/agent-sdk/src/services/session.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Cleaner Session File Names (Priority: P2)

**Goal**: Session files use UUIDv6 format without prefixes for cleaner file system organization and better programmatic access

**Independent Test**: Create new sessions and verify files are named with UUIDv6 format without prefixes (e.g., `01234567-89ab-6cde-f012-3456789abcde.jsonl`)

### Tests for User Story 2

**⚠️ TDD GATE: Implementation BLOCKED until tests T016-T017 are written and confirmed FAILING. Run tests to verify failure before proceeding with any implementation tasks below.**

- [X] T016 [P] [US2] Unit test for UUIDv6 generation and validation in packages/agent-sdk/tests/services/session.test.ts
- [X] T017 [P] [US2] Integration test for session file naming in packages/agent-sdk/tests/services/session.test.ts

### Implementation for User Story 2

**NOTE: Only proceed after tests T016-T017 are written and FAILING**

- [X] T018 [P] [US2] Implement generateSessionId() with UUIDv6 in packages/agent-sdk/src/services/session.ts
- [X] T019 [P] [US2] Update MessageManager constructor to use UUIDv6 IDs in packages/agent-sdk/src/managers/messageManager.ts
- [X] T020 [US2] Update session file path generation to use clean UUIDv6 names in packages/agent-sdk/src/services/session.ts
- [X] T021 [US2] Update getLatestSession() to use UUIDv6 time-ordering in packages/agent-sdk/src/services/session.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Directory Path Encoding (Priority: P3)

**Goal**: Working directory paths consistently encoded into safe directory names for reliable storage regardless of path complexity

**Independent Test**: Work in directories with spaces, special characters, or long paths and verify they are properly encoded into valid directory names

### Tests for User Story 3

- [X] T022 [P] [US3] Unit test for special character encoding in packages/agent-sdk/tests/utils/pathEncoder.test.ts
- [X] T023 [P] [US3] Unit test for path length limits and hash collision resolution in packages/agent-sdk/tests/utils/pathEncoder.test.ts
- [X] T024 [P] [US3] Integration test for symbolic link resolution in packages/agent-sdk/tests/utils/pathEncoder.test.ts

### Implementation for User Story 3

**⚠️ TDD GATE: Implementation BLOCKED until tests T022-T024 are written and confirmed FAILING. Verify test failures before proceeding.**

- [X] T025 [P] [US3] Implement PathEncoder.validateEncodedName() in packages/agent-sdk/src/utils/pathEncoder.ts
- [X] T026 [P] [US3] Implement PathEncoder.resolveCollision() in packages/agent-sdk/src/utils/pathEncoder.ts
- [X] T027 [US3] Add cross-platform filesystem constraints validation in packages/agent-sdk/src/utils/pathEncoder.ts
- [X] T028 [US3] Implement hash-based collision resolution for long paths in packages/agent-sdk/src/utils/pathEncoder.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T038 [P] Build agent-sdk package after all implementations
- [X] T039 [P] Run complete test suite for session management functionality
- [X] T040 Update session cleanup operations to work with new directory structure in packages/agent-sdk/src/services/session.ts
- [X] T041 [P] Verify error handling and recovery across all session operations
- [X] T042 [FR-012] Implement message persistence during AI recursion in sendAIMessage() finally block in packages/agent-sdk/src/managers/aiManager.ts
- [X] T043 [P] [FR-008] Update session cleanup operations for new directory structure in packages/agent-sdk/src/services/session.ts
- [X] T044 [P] [FR-009] Verify all existing session functionality (save, load, list, delete) works with new organization in packages/agent-sdk/tests/services/session.test.ts
- [X] T045 [FR-009] Add integration test for complete session lifecycle with new format in packages/agent-sdk/tests/services/session.test.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1 session service but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Enhances US1 path encoding but independently testable
- **Session Cleanup (FR-008/FR-009)**: Can start after any user story is complete - validates existing functionality preservation

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- PathEncoder utilities before session service integration
- Core implementation before advanced features
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- PathEncoder methods within a story marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit test for pathEncoder.encode() in packages/agent-sdk/tests/utils/pathEncoder.test.ts"
Task: "Unit test for pathEncoder.createProjectDirectory() in packages/agent-sdk/tests/utils/pathEncoder.test.ts"

# Launch all PathEncoder methods for User Story 1 together:
Task: "Implement PathEncoder.encode() method in packages/agent-sdk/src/utils/pathEncoder.ts"
Task: "Implement PathEncoder.resolvePath() method in packages/agent-sdk/src/utils/pathEncoder.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Project-based organization)
4. **STOP and VALIDATE**: Test User Story 1 independently
6. Deploy/demo if ready

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
   - Developer A: User Story 1 + PathEncoder tests
   - Developer B: User Story 2 (UUIDv6 implementation)
   - Developer C: User Story 3 (Path encoding enhancements)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability  
- Each user story should be independently completable and testable
- After modifying agent-sdk, build is required before testing in code package
- Verify tests fail before implementing (TDD approach)
- Performance improvements expected: 25x faster message append, 10x faster AI recursion saves
- Clean break approach - no backward compatibility for existing sessions