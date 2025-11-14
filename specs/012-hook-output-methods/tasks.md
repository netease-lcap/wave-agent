# Tasks: Hook Output Methods

**Input**: Design documents from `/specs/012-hook-output-methods/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL per project memory - only unit tests, not examples.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure) ✅ COMPLETED

**Purpose**: Project initialization and basic structure - extends existing monorepo

- [x] T001 Create hook output type definitions in packages/agent-sdk/src/types/hooks.ts
- [x] T002 [P] Extend MessageBlock union in packages/agent-sdk/src/types/messaging.ts to include WarnBlock and HookBlock
- [x] T003 [P] Create hook output parser utility in packages/agent-sdk/src/utils/hookOutputParser.ts

---

## Phase 2: Foundational (Blocking Prerequisites) ✅ COMPLETED

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Extend MessageManager with addWarnMessage and addHookMessage methods in packages/agent-sdk/src/managers/messageManager.ts
- [x] T005 [P] Extend convertMessagesForAPI to handle WarnBlock and HookBlock in packages/agent-sdk/src/utils/convertMessagesForAPI.ts
- [x] T006 [P] Create React WarnBlock component in packages/code/src/components/WarnBlock.tsx
- [x] T007 [P] Create React HookBlock component in packages/code/src/components/HookBlock.tsx
- [x] T008 Create Promise-based permission request types and interfaces in packages/agent-sdk/src/types/hooks.ts

**Checkpoint**: ✅ Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Simple Exit Code Communication (Priority: P1) 🎯 MVP

**Goal**: Implement exit code interpretation (0=success, 2=blocking, other=non-blocking error) with stdout/stderr processing

**Independent Test**: Create hooks returning different exit codes and verify Wave responds appropriately - continuing on 0, blocking on 2, showing errors for others

### Implementation for User Story 1

- [x] T009 [P] [US1] Implement exit code parsing logic in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T010 [P] [US1] Add exit code interpretation to hook executor in packages/agent-sdk/src/services/hookExecutor.ts  
- [x] T011 [US1] Integrate exit code processing with message creation in packages/agent-sdk/src/managers/messageManager.ts
- [x] T012 [US1] Create exit-code-communication.ts example in packages/agent-sdk/examples/exit-code-communication.ts
- [x] T013 [US1] Add hook output processing to AIManager sendMessage flow in packages/agent-sdk/src/managers/aiManager.ts

**Checkpoint**: At this point, User Story 1 should be fully functional - hooks can use exit codes to control Wave behavior

---

## Phase 4: User Story 2 - Advanced JSON Output Control (Priority: P2)

**Goal**: Implement JSON output parsing with common fields (continue, stopReason, systemMessage) that override exit code behavior

**Independent Test**: Create hooks returning JSON with various combinations of fields and verify Wave processes each correctly with JSON precedence over exit codes

### Implementation for User Story 2

- [x] T014 [P] [US2] Implement JSON parsing and validation logic in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T015 [P] [US2] Add JSON schema validation for common fields in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T016 [US2] Integrate JSON output processing with message creation in packages/agent-sdk/src/managers/messageManager.ts  
- [x] T017 [US2] Create json-output-control.ts example in packages/agent-sdk/examples/json-output-control.ts
- [x] T018 [US2] Update AIManager to handle JSON precedence over exit codes in packages/agent-sdk/src/managers/aiManager.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - hooks can use either exit codes or JSON

---

## Phase 5: User Story 3 - PreToolUse Permission Control (Priority: P2)

**Goal**: Implement PreToolUse hook JSON with permission decisions (allow/deny/ask) and tool input modification using Promise-based flow

**Independent Test**: Create PreToolUse hooks with different permission decisions and verify tools are allowed/blocked/modified appropriately with user confirmation for "ask"

### Implementation for User Story 3

- [x] T019 [P] [US3] Implement PreToolUse-specific JSON parsing in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T020 [P] [US3] Create Promise-based permission request system in packages/agent-sdk/src/services/hookExecutor.ts
- [x] T021 [P] [US3] Extend Agent class with permission management methods in packages/agent-sdk/src/agent.ts
- [x] T022 [P] [US3] Create ConfirmDialog component with Promise resolution in packages/code/src/components/ConfirmDialog.tsx
- [x] T023 [US3] Extend Chat context with Promise-based permission handling in packages/code/src/contexts/useChat.tsx
- [x] T024 [US3] Integrate permission flow with AIManager tool execution in packages/agent-sdk/src/managers/aiManager.ts
- [x] T025 [US3] Create pretooluse-permissions.ts example in packages/agent-sdk/examples/pretooluse-permissions.ts

**Checkpoint**: At this point, User Stories 1, 2 AND 3 should all work independently - PreToolUse hooks can control tool execution with user interaction

---

## Phase 6: User Story 4 - PostToolUse Feedback Integration (Priority: P3)

**Goal**: Implement PostToolUse hook JSON with automated feedback (decision: "block") and additional context injection for Wave

**Independent Test**: Create PostToolUse hooks with different decision values and additionalContext, verify Wave processes feedback appropriately

### Implementation for User Story 4

- [x] T026 [P] [US4] Implement PostToolUse-specific JSON parsing in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T027 [P] [US4] Add PostToolUse automated feedback processing in packages/agent-sdk/src/services/hookExecutor.ts
- [x] T028 [US4] Integrate PostToolUse feedback with AIManager tool completion in packages/agent-sdk/src/managers/aiManager.ts
- [x] T029 [US4] Create posttooluse-feedback.ts example in packages/agent-sdk/examples/posttooluse-feedback.ts

**Checkpoint**: User Stories 1-4 should all be independently functional - PostToolUse hooks can provide automated feedback to Wave

---

## Phase 7: User Story 5 - UserPromptSubmit and Stop Event Control (Priority: P3)

**Goal**: Implement UserPromptSubmit and Stop hook JSON with blocking decisions and context injection for session/prompt control

**Independent Test**: Create UserPromptSubmit and Stop hooks with different decision values, verify blocking/continuation behavior works correctly

### Implementation for User Story 5

- [x] T030 [P] [US5] Implement UserPromptSubmit-specific JSON parsing in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T031 [P] [US5] Implement Stop-specific JSON parsing in packages/agent-sdk/src/utils/hookOutputParser.ts
- [x] T032 [P] [US5] Add UserPromptSubmit context injection in packages/agent-sdk/src/services/hookExecutor.ts
- [x] T033 [US5] Integrate UserPromptSubmit and Stop processing with Agent message flow in packages/agent-sdk/src/agent.ts
- [x] T034 [US5] Create prompt-stop-control.ts example in packages/agent-sdk/examples/prompt-stop-control.ts

**Checkpoint**: All user stories should now be independently functional - full hook output control implemented

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and comprehensive testing

- [x] T035 [P] Create hookOutputParser.test.ts unit tests in packages/agent-sdk/tests/utils/hookOutputParser.test.ts
- [x] T036 [P] Create hookExecutor.test.ts unit tests in packages/agent-sdk/tests/services/hookExecutor.test.ts
- [x] T037 [P] Create hookOutput.test.ts integration tests in packages/agent-sdk/tests/integration/hookOutput.test.ts
- [x] T038 Build agent-sdk package with pnpm build before testing
- [x] T039 Run type-check and lint validation with typescript-expert
- [x] T040 Run comprehensive test suite with vitest-expert

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories  
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P2 → P3 → P3)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1 but builds on exit code foundation  
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Requires Promise-based UI components but independent testing
- **User Story 4 (P3)**: Can start after Foundational (Phase 2) - Independent testing and implementation
- **User Story 5 (P3)**: Can start after Foundational (Phase 2) - Independent testing and implementation

### Within Each User Story

- Parser logic before integration with existing systems
- Core implementation before example creation  
- Agent/SDK changes before UI integration (for US3)
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Parser implementations within stories marked [P] can run in parallel
- Component creation tasks marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 3 (Promise-Based Permissions)

```bash
# Launch all parser and component tasks for User Story 3 together:
Task: "Implement PreToolUse-specific JSON parsing in packages/agent-sdk/src/utils/hookOutputParser.ts"
Task: "Create Promise-based permission request system in packages/agent-sdk/src/services/hookExecutor.ts"  
Task: "Extend Agent class with permission management methods in packages/agent-sdk/src/agent.ts"
Task: "Create ConfirmDialog component with Promise resolution in packages/code/src/components/ConfirmDialog.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Simple Exit Codes)
4. **STOP and VALIDATE**: Test User Story 1 independently with exit-code-communication.ts example
5. Deploy/demo basic hook output functionality

### Incremental Delivery  

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP - basic exit codes!)
3. Add User Story 2 → Test independently → Deploy/Demo (JSON output control!)
4. Add User Story 3 → Test independently → Deploy/Demo (Permission system!)
5. Add User Story 4 → Test independently → Deploy/Demo (Automated feedback!)
6. Add User Story 5 → Test independently → Deploy/Demo (Full session control!)

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (exit codes) + User Story 2 (JSON)
   - Developer B: User Story 3 (permissions with Promise-based UI)
   - Developer C: User Story 4 (feedback) + User Story 5 (session control)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability  
- Each user story should be independently completable and testable
- Promise-based permission system (US3) is the most complex - requires Agent, UI, and context integration
- Exit codes (US1) and JSON (US2) form the foundation for all other stories
- Examples files provide real-world testing for each user story
- Build agent-sdk before testing due to monorepo dependencies
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently