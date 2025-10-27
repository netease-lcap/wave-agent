# Tasks: Wave Skills Support

**Input**: Design documents from `/specs/003-wave-skills-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Integration tests are included as specified in quickstart.md for end-to-end validation using temporary directories.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create feature branch 003-wave-skills-support from main
- [x] T002 [P] Verify agent-sdk package structure and dependencies
- [x] T003 [P] Run existing tests to ensure baseline functionality

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Extend type system with Skill interfaces in packages/agent-sdk/src/types.ts
- [x] T005 Create skill parsing function in packages/agent-sdk/src/utils/skillParser.ts
- [x] T006 Create SkillManager interface and implementation in packages/agent-sdk/src/managers/skillManager.ts
- [x] T007 Create SkillTool class-based implementation in packages/agent-sdk/src/tools/skillTool.ts
- [x] T008 Update ToolManager to register SkillTool in packages/agent-sdk/src/managers/toolManager.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 3 - Skill Discovery and Invocation (Priority: P1) 🎯 MVP

**Goal**: Wave autonomously discovers when to use available skills based on user requests and skill descriptions

**Independent Test**: Create skills with specific descriptions and verify Wave invokes them appropriately for matching requests

### Implementation for User Story 3

- [x] T009 [P] [US3] Implement skill directory discovery logic in packages/agent-sdk/src/managers/skillManager.ts
- [x] T010 [P] [US3] Implement skill metadata caching in packages/agent-sdk/src/managers/skillManager.ts
- [x] T011 [US3] Implement dynamic tool description generation in packages/agent-sdk/src/tools/skillTool.ts
- [x] T012 [US3] Implement skill content loading on-demand in packages/agent-sdk/src/managers/skillManager.ts
- [x] T013 [US3] Add skill validation and error handling in packages/agent-sdk/src/utils/skillParser.ts
- [x] T014 [US3] Implement priority resolution (project over personal) in packages/agent-sdk/src/managers/skillManager.ts

**Checkpoint**: At this point, Wave should be able to discover and invoke skills autonomously

---

## Phase 4: User Story 1 - Create Personal Wave Skills (Priority: P1)

**Goal**: Developer can create reusable skills for personal workflow that work across all Wave projects

**Independent Test**: Create a personal skill directory structure with SKILL.md file and verify Wave can discover and use it across multiple projects

### Implementation for User Story 1

- [x] T015 [P] [US1] Add personal skills directory resolution (~/.wave/skills/) in packages/agent-sdk/src/managers/skillManager.ts
- [x] T016 [P] [US1] Implement personal skill discovery in packages/agent-sdk/src/managers/skillManager.ts
- [x] T017 [US1] Add SKILL.md parsing validation for personal skills in packages/agent-sdk/src/utils/skillParser.ts
- [x] T018 [US1] Add personal skill error handling and user feedback in packages/agent-sdk/src/tools/skillTool.ts

**Checkpoint**: At this point, personal skills should be fully functional and testable independently

---

## Phase 5: User Story 2 - Create Project-Specific Wave Skills (Priority: P2)

**Goal**: Development teams can create shared skills that are version-controlled and automatically available to team members

**Independent Test**: Create project skills in .wave/skills/ directory, commit to git, and verify team members automatically have access

### Implementation for User Story 2

- [x] T019 [P] [US2] Add project skills directory resolution (.wave/skills/) in packages/agent-sdk/src/managers/skillManager.ts
- [x] T020 [P] [US2] Implement project skill discovery in packages/agent-sdk/src/managers/skillManager.ts
- [x] T021 [US2] Add project skill priority handling over personal skills in packages/agent-sdk/src/managers/skillManager.ts
- [x] T022 [US2] Add project skill validation and team sharing support in packages/agent-sdk/src/utils/skillParser.ts

**Checkpoint**: At this point, User Stories 1, 2, and 3 should all work independently

---

## Phase 6: User Story 4 - Skill Management and Validation (Priority: P3)

**Goal**: Users can validate skill definitions, understand requirements, and manage skill collections effectively

**Independent Test**: Create invalid skills and verify appropriate error messages, plus manage skill collections

### Implementation for User Story 4

- [x] T023 [P] [US4] Add comprehensive skill validation (name format, description length) in packages/agent-sdk/src/utils/skillParser.ts
- [x] T024 [P] [US4] Add detailed error messages for malformed YAML frontmatter in packages/agent-sdk/src/utils/skillParser.ts

**Checkpoint**: All user stories should now be independently functional with comprehensive validation

---

## Phase 7: Testing Infrastructure

**Purpose**: Comprehensive testing for all implemented functionality

- [x] T025 [P] Create unit tests for skillParser functions in packages/agent-sdk/tests/utils/skillParser.test.ts
- [x] T026 [P] Create unit tests for SkillManager methods in packages/agent-sdk/tests/managers/skillManager.test.ts
- [x] T027 [P] Create unit tests for SkillTool execution in packages/agent-sdk/tests/tools/skillTool.test.ts
- [x] T028 Create integration tests with temporary directories in packages/agent-sdk/tests/integration/skillTool.integration.test.ts
- [x] T029 Add test scenarios for personal skills discovery in packages/agent-sdk/tests/integration/skillTool.integration.test.ts
- [x] T030 Add test scenarios for project skills priority in packages/agent-sdk/tests/integration/skillTool.integration.test.ts
- [x] T031 Add test scenarios for skills with supporting files (skillPath context) in packages/agent-sdk/tests/integration/skillTool.integration.test.ts

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T032 [P] Code cleanup and refactoring across all skill-related modules
- [x] T033 [P] Performance optimization for skill discovery and loading
- [x] T034 Run type-check and lint validation across all modified files
- [ ] T035 Run quickstart.md validation with real skill examples
- [ ] T036 Run test.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Testing (Phase 7)**: Depends on implementation phases being complete
- **Polish (Phase 8)**: Depends on all desired user stories and testing being complete

### User Story Dependencies

- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Core discovery mechanism
- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - Builds on discovery mechanism
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Extends personal skills concept
- **User Story 4 (P3)**: Can start after other stories - Adds validation and management

### Within Each User Story

- Foundation components before specific implementations
- Core functionality before advanced features
- Error handling integrated throughout
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks can run sequentially (dependencies between components)
- Once Foundational phase completes, user stories can start in priority order
- All testing tasks marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members after foundation is complete

---

## Parallel Example: User Story 3

```bash
# Launch models and core logic together:
Task: "Implement skill directory discovery logic in packages/agent-sdk/src/managers/skillManager.ts"
Task: "Implement skill metadata caching in packages/agent-sdk/src/managers/skillManager.ts"

# After core logic is ready:
Task: "Implement dynamic tool description generation in packages/agent-sdk/src/tools/skillTool.ts"
```

---

## Implementation Strategy

### MVP First (User Story 3 + User Story 1)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 3 (Core discovery mechanism)
4. Complete Phase 4: User Story 1 (Personal skills)
5. **STOP and VALIDATE**: Test skill discovery and personal skills independently
6. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 3 (Discovery) → Test independently → Core mechanism working
3. Add User Story 1 (Personal Skills) → Test independently → MVP with personal skills
4. Add User Story 2 (Project Skills) → Test independently → Team collaboration enabled
5. Add User Story 4 (Validation) → Test independently → Production-ready with error handling
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 3 (Discovery mechanism)
   - Developer B: User Story 1 (Personal skills, depends on US3 core)
   - Developer C: Testing infrastructure preparation
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies within the same timeframe
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Integration tests use temporary directories for safe testing and cleanup
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on simplicity and reuse of existing agent-sdk patterns
- All tests must clean up temporary directories after execution
- Type-check and lint must pass after every modification