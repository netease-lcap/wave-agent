# Tasks: Remove Memory File Live Reloading and Simplify Memory Architecture

**Input**: Design documents from `/specs/028-remove-memory-reloading/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included for essential functionality validation as outlined in the constitution principles.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project setup and validation of existing structure

- [ ] T001 Validate current agent-sdk package structure and dependencies
- [ ] T002 [P] Run existing test suite to establish baseline in packages/agent-sdk/tests
- [ ] T003 [P] Run type-check and lint to establish quality baseline: `pnpm run type-check && pnpm lint`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure preparation that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create backup branches and prepare rollback strategy for agent-sdk modifications
- [ ] T005 [P] Document current memory loading flow and dependencies in packages/agent-sdk/src/services/memory.ts
- [ ] T006 [P] Document current configuration management dependencies between LiveConfigManager and ConfigurationWatcher
- [ ] T007 Identify all files importing MemoryStoreService and ConfigurationWatcher for impact analysis
- [ ] T008 Create migration plan validation script to verify architectural changes

**Checkpoint**: Foundation ready - user story implementation can now begin in priority order

---

## Phase 3: User Story 1 - Load Memory Files Only at Launch (Priority: P1) 🎯 MVP

**Goal**: Replace continuous memory file monitoring with one-time loading during agent initialization, storing content directly in Agent class

**Independent Test**: Launch agent with memory files present, verify content is loaded. Modify files on disk and confirm agent content remains unchanged. Restart agent and verify updated content is loaded.

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T009 [P] [US1] Create agent memory initialization test in packages/agent-sdk/tests/agent/agent.memory.test.ts
- [ ] T010 [P] [US1] Create memory content access test for readonly getters in packages/agent-sdk/tests/agent/agent.memory.test.ts
- [ ] T011 [P] [US1] Create memory loading error handling test in packages/agent-sdk/tests/agent/agent.memory.test.ts

### Implementation for User Story 1

- [ ] T012 [US1] Add memory content private properties to Agent class in packages/agent-sdk/src/agent.ts
- [ ] T013 [US1] Add memory content public getters to Agent class in packages/agent-sdk/src/agent.ts
- [ ] T014 [US1] Implement memory file loading in Agent.initialize() method in packages/agent-sdk/src/agent.ts
- [ ] T015 [US1] Add graceful error handling for missing/corrupted memory files in packages/agent-sdk/src/agent.ts
- [ ] T016 [US1] Update Agent.saveMemory() method to refresh internal content after file writes in packages/agent-sdk/src/agent.ts

**Checkpoint**: At this point, Agent class should load memory once at startup and provide readonly access through getters

---

## Phase 4: User Story 2 - Consolidate Memory Storage in Agent Class (Priority: P1)

**Goal**: Remove MemoryStoreService abstraction and ensure all memory content is managed directly by Agent class

**Independent Test**: Review Agent class properties to confirm memory content is stored as instance variables. Verify MemoryStoreService class no longer exists.

### Tests for User Story 2

- [ ] T017 [P] [US2] Create test to verify memory content updates when saveMemory is called in packages/agent-sdk/tests/agent/agent.memory.test.ts
- [ ] T018 [P] [US2] Create test to ensure memory service functions work with Agent-based storage in packages/agent-sdk/tests/services/memory.test.ts

### Implementation for User Story 2

- [ ] T019 [US2] Remove MemoryStoreService import and initialization from Agent constructor in packages/agent-sdk/src/agent.ts
- [ ] T020 [US2] Remove MemoryStoreService dependency from HookManager initialization in packages/agent-sdk/src/agent.ts
- [ ] T021 [US2] Update memory utility functions to work without global MemoryStoreService in packages/agent-sdk/src/services/memory.ts
- [ ] T022 [US2] Remove initializeMemoryStore() call and global memory store references in packages/agent-sdk/src/services/memory.ts
- [ ] T023 [US2] Update addMemory function to work with direct file operations in packages/agent-sdk/src/services/memory.ts

**Checkpoint**: At this point, Agent class should be the single source of truth for memory content with no MemoryStoreService dependencies

---

## Phase 5: User Story 3 - Remove Memory Store Infrastructure (Priority: P2)

**Goal**: Clean up codebase by removing unused memory store type definitions and service files

**Independent Test**: Confirm memory store files no longer exist and no remaining code references them

### Tests for User Story 3

- [ ] T024 [P] [US3] Create test to verify memory store files are deleted in packages/agent-sdk/tests/services/memory.test.ts
- [ ] T025 [P] [US3] Update existing memory tests to work with simplified architecture in packages/agent-sdk/tests/services/memory.test.ts

### Implementation for User Story 3

- [ ] T026 [P] [US3] Delete packages/agent-sdk/src/types/memoryStore.ts file
- [ ] T027 [P] [US3] Delete packages/agent-sdk/src/services/memoryStore.ts file  
- [ ] T028 [US3] Remove MemoryStoreService imports from all remaining files in packages/agent-sdk/src
- [ ] T029 [US3] Remove memory store references from LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [ ] T030 [US3] Delete or update packages/agent-sdk/tests/services/memoryStore.test.ts

**Checkpoint**: At this point, codebase should be clean with no memory store infrastructure remaining

---

## Phase 6: User Story 4 - Merge Configuration Management Components (Priority: P2)

**Goal**: Eliminate confusion by merging ConfigurationWatcher into LiveConfigManager to create single configuration management component

**Independent Test**: Verify only LiveConfigManager exists and handles both settings watching and configuration coordination. Settings file changes should still be detected properly.

### Tests for User Story 4

- [ ] T031 [P] [US4] Create test for merged configuration watching functionality in packages/agent-sdk/tests/managers/liveConfigManager.test.ts
- [ ] T032 [P] [US4] Create test to ensure settings file watching still works in packages/agent-sdk/tests/managers/liveConfigManager.test.ts

### Implementation for User Story 4

- [ ] T033 [US4] Move ConfigurationWatcher private state to LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [ ] T034 [US4] Integrate ConfigurationWatcher core methods as private methods in LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts  
- [ ] T035 [US4] Update LiveConfigManager.initialize() to handle configuration watching directly in packages/agent-sdk/src/managers/liveConfigManager.ts
- [ ] T036 [US4] Remove memory file watching functionality from LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [ ] T037 [US4] Delete packages/agent-sdk/src/services/configurationWatcher.ts file
- [ ] T038 [US4] Update imports and references to use merged LiveConfigManager in packages/agent-sdk/src

**Checkpoint**: At this point, configuration management should be consolidated with settings watching preserved but memory watching removed

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, testing, and quality assurance

- [ ] T039 [P] Run comprehensive test suite to ensure all functionality works: `cd packages/agent-sdk && pnpm test`
- [ ] T040 [P] Run type-check validation: `pnpm run type-check`
- [ ] T041 [P] Run lint validation: `pnpm lint`
- [ ] T042 [P] Build agent-sdk package: `cd packages/agent-sdk && pnpm build`
- [ ] T043 Test agent-sdk in dependent packages to verify no breaking changes
- [ ] T044 [P] Update inline documentation and code comments for modified files
- [ ] T045 Run quickstart.md validation scenarios manually
- [ ] T046 Create migration notes for any affected internal APIs

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User Stories 1 & 2 (P1 priority) should be completed first as they are core architectural changes
  - User Stories 3 & 4 (P2 priority) can proceed after P1 stories are stable
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Depends on User Story 1 completion - Builds on Agent class memory properties
- **User Story 3 (P2)**: Depends on User Story 2 completion - Removes infrastructure after consolidation
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Independent of memory changes

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Agent class modifications before utility function updates
- Core implementation before cleanup tasks
- Story complete before moving to next priority

### Parallel Opportunities

- Phase 1 & 2: All tasks marked [P] can run in parallel
- User Story tests: All tests within a story marked [P] can run in parallel
- User Story 3 & 4: Can run in parallel after their dependencies are met
- Polish phase: All tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Create agent memory initialization test in packages/agent-sdk/tests/agent/agent.memory.test.ts"
Task: "Create memory content access test for readonly getters in packages/agent-sdk/tests/agent/agent.memory.test.ts"
Task: "Create memory loading error handling test in packages/agent-sdk/tests/agent/agent.memory.test.ts"

# After tests are written and failing, implement in sequence:
# T012 → T013 → T014 → T015 → T016 (dependencies due to same file modifications)
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Memory loading at startup)
4. Complete Phase 4: User Story 2 (Consolidate storage)
5. **STOP and VALIDATE**: Test memory functionality independently
6. Run quality gates and deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Core memory loading works
3. Add User Story 2 → Test independently → Memory fully consolidated 
4. Add User Story 3 → Test independently → Clean codebase
5. Add User Story 4 → Test independently → Configuration simplified
6. Each story adds value without breaking previous functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Stories 1 & 2 (sequential - same files)
   - Developer B: User Story 4 (independent - different files)
3. After User Stories 1 & 2 complete:
   - Developer A: User Story 3 (depends on US2)
   - Developer B: Continues with User Story 4
4. Stories integrate and test independently

---

## Summary

- **Total Tasks**: 46 tasks
- **User Story 1**: 8 tasks (3 tests + 5 implementation)
- **User Story 2**: 7 tasks (2 tests + 5 implementation)  
- **User Story 3**: 7 tasks (2 tests + 5 implementation)
- **User Story 4**: 8 tasks (2 tests + 6 implementation)
- **Support Tasks**: 16 tasks (setup, foundational, polish)

**Parallel Opportunities**: 18 tasks marked [P] can run in parallel within their phases

**Independent Test Criteria**: 
- User Story 1: Agent loads memory once at startup, content accessible via getters
- User Story 2: Memory stored directly in Agent class, no MemoryStoreService dependencies
- User Story 3: Clean codebase with memory store files removed
- User Story 4: Single configuration manager handles settings watching

**Suggested MVP Scope**: User Stories 1 & 2 (core memory architecture changes)

**Format Validation**: ✅ All tasks follow required checklist format with checkbox, ID, labels, and file paths