# Tasks: Hooks Support

**Input**: Design documents from `/specs/001-hooks-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create hooks directory structure in packages/agent-sdk/src/hooks/
- [x] T002 [P] Create hooks tests directory structure in packages/agent-sdk/tests/hooks/
- [x] T003 [P] Create hooks examples directory structure in packages/agent-sdk/examples/hooks/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Create hook type definitions in packages/agent-sdk/src/hooks/types.ts
- [x] T005 [P] Create hook matcher for pattern matching in packages/agent-sdk/src/hooks/matcher.ts
- [x] T006 [P] Create hook executor for command execution in packages/agent-sdk/src/hooks/executor.ts
- [x] T007 Create hook manager with configuration loading in packages/agent-sdk/src/hooks/manager.ts
- [x] T008 Export hooks module in packages/agent-sdk/src/hooks/index.ts
- [x] T009 Update main agent-sdk index.ts to export hooks functionality
- [x] T010 Create unit tests for hook types validation in packages/agent-sdk/tests/hooks/types.test.ts
- [x] T011 [P] Create unit tests for hook matcher patterns in packages/agent-sdk/tests/hooks/matcher.test.ts
- [x] T012 [P] Create unit tests for hook executor with mocked child processes in packages/agent-sdk/tests/hooks/executor.test.ts
  - ⚠️ Note: 17/18 tests pass - one test for environment variable resolution has mocking issue with args indexing
- [x] T013 Create unit tests for hook manager configuration loading in packages/agent-sdk/tests/hooks/manager.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure Hook for Code Quality Checks (Priority: P1) 🎯 MVP

**Goal**: Enable PostToolUse hooks for automated code quality checks after Edit operations

**Independent Test**: Configure a PostToolUse hook for Edit operations, edit a file using Wave, verify the quality check command executes automatically

### Implementation for User Story 1

- [x] T014 [US1] Integrate HookManager into Agent class in packages/agent-sdk/src/agent.ts ✅
- [x] T015 [US1] Add PostToolUse hook execution point after tool completion in packages/agent-sdk/src/agent.ts ✅
- [x] T016 [US1] Implement settings loading and merging for hook configuration in packages/agent-sdk/src/hooks/manager.ts ✅
- [x] T017 [US1] Add hook execution logging with non-blocking error handling in packages/agent-sdk/src/hooks/executor.ts ✅
- [x] T018 [US1] Create integration test with temporary directory for PostToolUse Edit hooks in packages/agent-sdk/examples/hooks/post-tool-edit.example.ts ✅
- [x] T019 [US1] Add hook execution validation and error reporting in packages/agent-sdk/src/hooks/manager.ts ✅

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Validate User Prompts Before Processing (Priority: P2)

**Goal**: Enable UserPromptSubmit hooks for prompt validation and context enhancement

**Independent Test**: Configure a UserPromptSubmit hook, submit a prompt, verify validation script executes before Wave processes the prompt

### Implementation for User Story 2

- [x] T020 [US2] Add UserPromptSubmit hook execution point before prompt processing in packages/agent-sdk/src/agent.ts
- [x] T021 [US2] Implement UserPromptSubmit hook execution without matcher in packages/agent-sdk/src/hooks/manager.ts
- [x] T022 [US2] Add WAVE_PROJECT_DIR environment variable injection in packages/agent-sdk/src/hooks/executor.ts
- [x] T023 [US2] Create integration test for UserPromptSubmit hooks with temporary project structure in packages/agent-sdk/examples/hooks/user-prompt-submit.example.ts
- [x] T024 [US2] Add configuration validation for UserPromptSubmit hooks in packages/agent-sdk/src/hooks/manager.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Execute Tasks After AI Response Completion (Priority: P3)

**Goal**: Enable Stop hooks for post-processing after AI response cycles complete

**Independent Test**: Configure a Stop hook, complete a Wave response cycle with no more tool calls, verify configured tasks execute

### Implementation for User Story 3

- [x] T025 [US3] Add PreToolUse hook execution point before tool processing in packages/agent-sdk/src/agent.ts
- [x] T026 [US3] Add Stop hook execution point when AI response cycle completes in packages/agent-sdk/src/agent.ts
- [x] T027 [US3] Implement Stop hook execution without matcher requirements in packages/agent-sdk/src/hooks/manager.ts
- [x] T028 [US3] Create integration test for Stop hooks with response cycle simulation in packages/agent-sdk/examples/hooks/stop-hooks.example.ts
- [x] T029 [US3] Add PreToolUse hook integration test for comprehensive coverage in packages/agent-sdk/examples/hooks/pre-tool-use.example.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T030 [P] Add comprehensive timeout handling and process cleanup in packages/agent-sdk/src/hooks/executor.ts
- [x] T031 [P] Add cross-platform command execution support in packages/agent-sdk/src/hooks/executor.ts
- [x] T033 Add multiple hooks execution and ordering validation in packages/agent-sdk/tests/hooks/manager.test.ts
- [x] T035 Run pnpm build and test hooks integration with code package

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1, focuses on different hook event
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Independent of US1/US2, adds remaining hook events

### Within Each User Story

- Agent integration before hook execution points
- Settings integration before configuration validation
- Core implementation before integration tests
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Cross-cutting improvements in Polish phase marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Core hook infrastructure (Foundational Phase):
Task: "Create hook type definitions in packages/agent-sdk/src/hooks/types.ts"
Task: "Create hook matcher for pattern matching in packages/agent-sdk/src/hooks/matcher.ts"
Task: "Create hook executor for command execution in packages/agent-sdk/src/hooks/executor.ts"

# Unit tests for foundational components:
Task: "Create unit tests for hook matcher patterns in packages/agent-sdk/tests/hooks/matcher.test.ts"  
Task: "Create unit tests for hook executor with mocked child processes in packages/agent-sdk/tests/hooks/executor.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (PostToolUse hooks for code quality)
4. **STOP and VALIDATE**: Test User Story 1 independently with Edit operations
5. Build and test integration with existing Wave Code workflows

### Incremental Delivery

1. Complete Setup + Foundational → Hook infrastructure ready
2. Add User Story 1 → Test PostToolUse hooks independently → Usable for code quality workflows (MVP!)
3. Add User Story 2 → Test UserPromptSubmit hooks independently → Enhanced prompt validation
4. Add User Story 3 → Test PreToolUse and Stop hooks independently → Complete hook lifecycle
5. Each story adds hook events without breaking existing functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (PostToolUse integration)
   - Developer B: User Story 2 (UserPromptSubmit integration)
   - Developer C: User Story 3 (PreToolUse + Stop integration)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability  
- Each user story focuses on specific hook events to maintain independence
- Hook execution must be non-blocking to maintain Wave Code reliability
- Integration tests use temporary directories for isolation
- Build agent-sdk after changes before testing in code package
- Follow monorepo constitution: TypeScript strict mode, no any types, test structure alignment