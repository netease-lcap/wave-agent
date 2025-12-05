# Tasks: Simplify Session Metadata Storage

**Input**: Design documents from `/specs/023-simplify-session-metadata/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project structure verification and TypeScript environment setup

- [X] T001 Verify existing packages/agent-sdk/ structure matches plan.md requirements
- [X] T002 [P] Set up TypeScript compilation for agent-sdk package changes
- [X] T003 [P] Prepare test environment for Vitest in packages/agent-sdk/tests/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core interface cleanup and utility functions that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Remove SessionMetadataLine interface from packages/agent-sdk/src/types/session.ts
- [X] T005 Remove SessionMetadata interface from packages/agent-sdk/src/types/session.ts
- [X] T006 [P] Create SessionFilename interface in packages/agent-sdk/src/types/session.ts
- [X] T007 [P] Create filename validation utilities in packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T008 [P] Create filename parsing utilities in packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T009 Remove readMetadata function completely from packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T010 Update all imports that reference removed interfaces across agent-sdk package

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Developer Creates Session Files Without Metadata Line (Priority: P1) 🎯 MVP

**Goal**: Create session files that contain only message content without metadata headers, enabling performance improvements

**Independent Test**: Create new sessions and verify files contain only messages, no metadata line

### Tests for User Story 1 ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T011 [P] [US1] Unit test for session creation without metadata in packages/agent-sdk/tests/services/jsonlHandler.test.ts
- [X] T012 [P] [US1] Unit test for filename generation in packages/agent-sdk/tests/services/jsonlHandler.test.ts
- [X] T013 [P] [US1] Integration test for session file structure in packages/agent-sdk/tests/integration/session-metadata.integration.test.ts

### Implementation for User Story 1

- [X] T014 [P] [US1] Update createSession method in packages/agent-sdk/src/services/jsonlHandler.ts to remove metadata writing
- [X] T015 [P] [US1] Implement generateSessionFilename method in packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T016 [US1] Update session creation workflow in packages/agent-sdk/src/services/session.ts to use new filename format
- [X] T017 [US1] Update createSession function in packages/agent-sdk/src/services/session.ts to remove metadata handling
- [X] T018 [US1] Remove hasMetadata function and all its usages from packages/agent-sdk/src/services/jsonlHandler.ts

**Checkpoint**: At this point, new session files should be created without metadata headers and use simple filenames

---

## Phase 4: User Story 2 - Developer Works with Subagent Sessions Using Filename Prefix (Priority: P2)

**Goal**: Identify subagent sessions by "subagent-" filename prefix without reading file content

**Independent Test**: Create subagent sessions and verify filenames start with "subagent-" prefix, can be filtered efficiently

### Tests for User Story 2 ⚠️

- [X] T019 [P] [US2] Unit test for subagent filename generation in packages/agent-sdk/tests/services/jsonlHandler.test.ts
- [X] T020 [P] [US2] Unit test for subagent session identification in packages/agent-sdk/tests/services/session.test.ts
- [X] T021 [P] [US2] Integration test for subagent filtering in packages/agent-sdk/tests/integration/session-metadata.integration.test.ts

### Implementation for User Story 2

- [X] T022 [P] [US2] Implement generateSubagentFilename function in packages/agent-sdk/src/services/session.ts
- [X] T023 [P] [US2] Update subagent session creation to use "subagent-" prefix in packages/agent-sdk/src/managers/messageManager.ts
- [X] T024 [US2] Add subagent session type detection in parseSessionFilename method in packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T025 [US2] Update session filtering logic to use filename patterns instead of metadata in packages/agent-sdk/src/services/session.ts

**Checkpoint**: At this point, subagent sessions should be identifiable by filename prefix without reading file content

---

## Phase 5: Core Performance Optimization

**Purpose**: Eliminate metadata reading from session listing operations

### Tests for Performance Optimization ⚠️

- [X] T026 [P] Unit test for listSessionsFromJsonl without readMetadata calls in packages/agent-sdk/tests/services/session.test.ts

### Implementation for Performance Optimization

- [X] T027 Update listSessionsFromJsonl function in packages/agent-sdk/src/services/session.ts to use filename parsing only
- [X] T028 [P] Implement parseSessionFilename method in packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T029 [P] Implement isValidSessionFilename method in packages/agent-sdk/src/services/jsonlHandler.ts
- [X] T030 Update session listing to return inline objects instead of SessionMetadata interface
- [X] T031 Remove all readMetadata function calls from session listing operations
- [X] T032 Update lastActiveAt and token information extraction to read only last message

**Checkpoint**: Session listing should now work without reading metadata headers, achieving performance goals

---

## Phase 6: Cleanup & Validation

**Purpose**: Remove unused code and validate all functionality

- [X] T033 [P] Remove startedAt and parentSessionId from any remaining session-related structures
- [X] T034 [P] Clean up all unused imports and references to removed interfaces
- [X] T035 [P] Update TypeScript types to reflect new session listing return format
- [X] T036 [P] Run comprehensive test suite to ensure no regressions
- [X] T037 Verify backward compatibility with existing session restoration operations
- [X] T038 [P] Update any remaining documentation or comments referencing removed interfaces

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Performance Optimization (Phase 5)**: Depends on both user stories being complete
- **Cleanup (Phase 6)**: Depends on all previous phases being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1 but may share some utilities

### Within Each Phase

- Tests MUST be written and FAIL before implementation
- Interface removal before new interface creation
- Utility functions before services that use them
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)  
- Once Foundational phase completes, both user stories can start in parallel
- All tests for a user story marked [P] can run in parallel
- Implementation tasks within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1  
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Verify new sessions work correctly without metadata headers

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Session creation without metadata works
3. Add User Story 2 → Test independently → Subagent identification works  
4. Add Performance Optimization → Test performance gains → Session listing optimized
5. Add Cleanup → Final validation → Feature complete

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (T011-T018)
   - Developer B: User Story 2 (T019-T025)  
3. Merge and proceed to Performance Optimization together
4. Complete Cleanup phase together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on performance: eliminate all metadata reading from session listing operations
- Maintain backward compatibility for session restoration and message operations