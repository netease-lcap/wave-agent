# Tasks: Hooks Support

**Input**: Design documents from `/specs/005-hooks/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create directory structure in packages/agent-sdk/src/ (managers, services, utils, types)
- [x] T002 [P] Create tests directory structure in packages/agent-sdk/tests/ (managers, services, utils, types)
- [x] T003 [P] Create hooks examples directory structure in packages/agent-sdk/examples/hooks/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Create hook type definitions in packages/agent-sdk/src/types/hooks.ts
- [x] T005 [P] Create hook matcher for pattern matching in packages/agent-sdk/src/utils/hookMatcher.ts
- [x] T006 [P] Create hook executor for command execution in packages/agent-sdk/src/services/hook.ts
- [x] T007 Create hook manager with configuration loading in packages/agent-sdk/src/managers/hookManager.ts
- [x] T008 Export hooks module in packages/agent-sdk/src/hooks/index.ts
- [x] T009 Update main agent-sdk index.ts to export hooks functionality
- [x] T010 Create unit tests for hook types validation in packages/agent-sdk/tests/types/hooks.test.ts
- [x] T011 [P] Create unit tests for hook matcher patterns in packages/agent-sdk/tests/utils/hookMatcher.test.ts
- [x] T012 [P] Create unit tests for hook executor in packages/agent-sdk/tests/services/hook.test.ts
- [x] T013 Create unit tests for hook manager configuration loading in packages/agent-sdk/tests/managers/hookManager.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure Hook for Code Quality Checks (Priority: P1) 🎯 MVP

**Goal**: Enable PostToolUse hooks for automated code quality checks after Edit operations

**Independent Test**: Configure a PostToolUse hook for Edit operations, edit a file using Wave, verify the quality check command executes automatically

### Implementation for User Story 1

- [x] T014 [US1] Integrate HookManager into Agent class in packages/agent-sdk/src/agent.ts ✅
- [x] T015 [US1] Add PostToolUse hook execution point after tool completion in packages/agent-sdk/src/agent.ts ✅
- [x] T016 [US1] Implement settings loading and merging for hook configuration in packages/agent-sdk/src/services/hook.ts ✅
- [x] T017 [US1] Add hook execution logging with non-blocking error handling in packages/agent-sdk/src/services/hook.ts ✅
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
- [x] T022 [US2] Add WAVE_PROJECT_DIR environment variable injection in packages/agent-sdk/src/services/hook.ts
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

- [x] T030 [P] Add comprehensive timeout handling and process cleanup in packages/agent-sdk/src/services/hook.ts
- [x] T031 [P] Add cross-platform command execution support in packages/agent-sdk/src/services/hook.ts
- [x] T033 Add multiple hooks execution and ordering validation in packages/agent-sdk/tests/hooks/manager.test.ts
- [x] T035 Run pnpm build and test hooks integration with code package

---

---

## Phase 7: Setup (JSON Input)

**Purpose**: Project initialization and basic structure for JSON input

- [x] T036 Create JSON input type definitions in packages/agent-sdk/src/types/hooks.ts
- [x] T037 [P] Add session path utility import from session.ts to types.ts

---

## Phase 8: Foundational (JSON Input)

**Purpose**: Core infrastructure for JSON input

- [x] T038 Extend HookExecutionContext interface in packages/agent-sdk/src/types/hooks.ts
- [x] T039 Implement JSON input builder function in packages/agent-sdk/src/services/hook.ts
- [x] T040 Add stdin JSON write functionality to HookExecutor in packages/agent-sdk/src/services/hook.ts
- [x] T041 [P] Update HookManager to pass extended context in packages/agent-sdk/src/managers/hookManager.ts
- [x] T042 [P] Build and validate agent-sdk package with pnpm build

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 9: User Story 4 - PreToolUse Hook Data Access (Priority: P1) 🎯 MVP

**Goal**: Hooks receive JSON with session context, tool name, and tool input for PreToolUse events

**Independent Test**: `jq -r '.session_id, .transcript_path, .cwd, .hook_event_name, .tool_name, .tool_input'`

### Implementation for User Story 4

- [x] T043 [US4] Collect tool input data in aiManager PreToolUse execution in packages/agent-sdk/src/managers/aiManager.ts
- [x] T044 [US4] Pass sessionId and toolInput through extended context in packages/agent-sdk/src/managers/aiManager.ts
- [x] T045 [US4] Create PreToolUse hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [x] T046 [US4] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, PreToolUse hooks receive complete JSON data and can be tested with jq

---

## Phase 10: User Story 5 - PostToolUse Hook Response Analysis (Priority: P2)

**Goal**: Hooks receive JSON with tool input, tool response, and session context for PostToolUse events

**Independent Test**: `jq -r '.tool_input, .tool_response'`

### Implementation for User Story 5

- [x] T047 [US5] Collect tool response data in aiManager PostToolUse execution in packages/agent-sdk/src/managers/aiManager.ts
- [x] T048 [US5] Pass toolResponse through extended context in packages/agent-sdk/src/managers/aiManager.ts
- [x] T049 [US5] Add PostToolUse hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [x] T050 [US5] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, PostToolUse hooks receive tool input and response data and can be tested with jq

---

## Phase 11: User Story 6 - Session Access via Transcript Path (Priority: P2)

**Goal**: Hooks can access complete conversation history using transcript_path field

**Independent Test**: `jq -r '.transcript_path' | xargs cat | jq '.state.messages'`

### Implementation for User Story 6

- [x] T051 [US6] Implement session ID collection in Agent class in packages/agent-sdk/src/agent.ts
- [x] T052 [US6] Pass sessionId to all hook manager calls in packages/agent-sdk/src/agent.ts
- [x] T053 [US6] Add transcript path generation using getSessionFilePath in packages/agent-sdk/src/services/hook.ts
- [x] T054 [US6] Add session access example in packages/agent-sdk/examples/hook-json-input.ts
- [x] T055 [US6] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, hooks can access session data via transcript_path

---

## Phase 12: User Story 7 - UserPromptSubmit Hook Monitoring (Priority: P3)

**Goal**: Hooks receive user prompt text and session context for UserPromptSubmit events

**Independent Test**: `jq -r '.prompt'`

### Implementation for User Story 7

- [ ] T056 [US7] Collect user prompt data in InteractionService.sendMessage in packages/agent-sdk/src/services/interactionService.ts
- [ ] T057 [US7] Pass userPrompt through extended context in packages/agent-sdk/src/services/interactionService.ts
- [ ] T058 [US7] Add UserPromptSubmit hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [ ] T059 [US7] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, UserPromptSubmit hooks receive prompt text and session context

---

## Phase 13: User Story 8 - Stop Hook Cleanup Actions (Priority: P3)

**Goal**: Hooks receive minimal JSON for session termination with cleanup capabilities

**Independent Test**: `jq -r '.hook_event_name'`

### Implementation for User Story 8

- [ ] T060 [US8] Ensure Stop hook receives sessionId in aiManager stop execution in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T061 [US8] Add Stop hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [ ] T062 [US8] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: All user stories should now be independently functional

---

## Phase 14: Polish (JSON Input)

**Purpose**: Improvements that affect multiple user stories

- [ ] T063 [P] Complete hook-json-input.ts example with all event types in packages/agent-sdk/examples/hook-json-input.ts
- [ ] T064 [P] Test example execution with pnpm tsx examples/hook-json-input.ts
- [ ] T065 Add error handling for JSON construction failures in packages/agent-sdk/src/services/hook.ts
- [ ] T066 Add error handling for stdin write failures in packages/agent-sdk/src/services/hook.ts
---

## Phase 15: Setup (Hook Exit Code Output)

**Purpose**: Project initialization and basic structure for exit code support

- [x] T068 Create enhanced message manager method in packages/agent-sdk/src/managers/messageManager.ts
- [x] T069 Create utility function in packages/agent-sdk/src/utils/messageOperations.ts
- [x] T070 [P] Create test directory structure in packages/agent-sdk/tests/agent/hooks-exitcode-output/

---

## Phase 16: Foundational (Hook Exit Code Output)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T071 Implement removeLastUserMessage() method in packages/agent-sdk/src/managers/messageManager.ts
- [x] T072 [P] Implement removeLastUserMessage() utility function in packages/agent-sdk/src/utils/messageOperations.ts
- [x] T073 [P] Create hook output processing logic base structure in packages/agent-sdk/src/managers/hookManager.ts
- [x] T074 Setup test mocking infrastructure in packages/agent-sdk/tests/agent/hooks-exitcode-output/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 17: User Story 11 - Hook Success Feedback (Priority: P1) 🎯 MVP

**Goal**: Enable hooks to provide successful execution feedback with appropriate context handling for UserPromptSubmit and other hook types

**Independent Test**: Execute hooks that return exit code 0 and verify stdout handling varies by hook type through agent.messages validation

### Tests for User Story 11

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T075 [P] [US11] Create success behavior test file in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts
- [x] T076 [P] [US11] Test UserPromptSubmit success with stdout injection in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts
- [x] T077 [P] [US11] Test other hook types ignore stdout in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-success.test.ts

### Implementation for User Story 11

- [x] T078 [P] [US11] Add UserPromptSubmit hook result processing in packages/agent-sdk/src/agent.ts
- [x] T079 [P] [US11] Add PreToolUse hook result processing in packages/agent-sdk/src/managers/aiManager.ts
- [x] T080 [P] [US11] Add PostToolUse hook result processing in packages/agent-sdk/src/managers/aiManager.ts
- [x] T081 [P] [US11] Add Stop hook result processing in packages/agent-sdk/src/managers/aiManager.ts
- [x] T082 [US11] Implement exit code 0 handling logic in packages/agent-sdk/src/managers/hookManager.ts
- [x] T083 [US11] Add hook success validation and error handling in packages/agent-sdk/src/agent.ts

**Checkpoint**: At this point, User Story 11 should be fully functional and testable independently

---

## Phase 18: User Story 12 - Hook Blocking Error Handling (Priority: P1)

**Goal**: Enable hooks to block operations and provide error feedback to appropriate recipients based on hook event type

**Independent Test**: Execute hooks that return exit code 2 and verify different blocking behaviors per hook type through agent.messages validation

### Tests for User Story 12

- [x] T084 [P] [US12] Create blocking error test file in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [x] T085 [P] [US12] Test UserPromptSubmit blocking with prompt erasure in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [x] T086 [P] [US12] Test PreToolUse tool blocking with agent feedback in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [x] T087 [P] [US12] Test PostToolUse feedback without blocking in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts
- [x] T088 [P] [US12] Test Stop operation blocking with agent feedback in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-blocking-errors.test.ts

### Implementation for User Story 12

- [x] T089 [US12] Implement UserPromptSubmit exit code 2 blocking in packages/agent-sdk/src/agent.ts
- [x] T090 [US12] Implement PreToolUse exit code 2 processing in packages/agent-sdk/src/managers/aiManager.ts
- [x] T091 [US12] Implement PostToolUse exit code 2 processing in packages/agent-sdk/src/managers/aiManager.ts
- [x] T092 [US12] Implement Stop exit code 2 processing with AI continuation in packages/agent-sdk/src/managers/aiManager.ts
- [x] T093 [US12] Add exit code 2 routing logic in packages/agent-sdk/src/managers/hookManager.ts
- [x] T094 [US12] Integrate prompt erasure functionality in packages/agent-sdk/src/agent.ts

**Checkpoint**: At this point, User Stories 11 AND 12 should both work independently

---

## Phase 19: User Story 13 - Hook Non-Blocking Error Reporting (Priority: P2)

**Goal**: Enable hooks to report non-critical errors that display to users while allowing continued execution

**Independent Test**: Execute hooks that return exit codes other than 0 or 2 and verify error display with continued execution

### Tests for User Story 13

- [x] T095 [P] [US13] Create non-blocking error test file in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-non-blocking-errors.test.ts
- [x] T096 [P] [US13] Test non-blocking errors show to user in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-non-blocking-errors.test.ts
- [x] T097 [P] [US13] Test execution continues after non-blocking errors in packages/agent-sdk/tests/agent/hooks-exitcode-output/hook-non-blocking-errors.test.ts

### Implementation for User Story 13

- [x] T098 [P] [US13] Add non-blocking error handling in packages/agent-sdk/src/agent.ts
- [x] T099 [P] [US13] Add non-blocking error handling in packages/agent-sdk/src/managers/aiManager.ts
- [x] T100 [US13] Implement non-blocking exit code routing in packages/agent-sdk/src/managers/hookManager.ts
- [x] T101 [US13] Add error display logic for all hook types in packages/agent-sdk/src/managers/hookManager.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 20: Polish & Cross-Cutting Concerns (Hook Exit Code Output)

**Purpose**: Improvements that affect multiple user stories

- [x] T102 Run type check validation: pnpm run type-check
- [x] T103 Run lint validation: pnpm run lint
- [x] T104 Build agent-sdk package: pnpm build

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