# Tasks: Hook JSON Input Support

**Input**: Design documents from `/specs/002-hook-json-input/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT requested in the feature specification. Focus on concise testing using jq.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create JSON input type definitions in packages/agent-sdk/src/hooks/types.ts
- [x] T002 [P] Add session path utility import from session.ts to types.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Extend HookExecutionContext interface in packages/agent-sdk/src/hooks/types.ts
- [x] T004 Implement JSON input builder function in packages/agent-sdk/src/hooks/executor.ts
- [x] T005 Add stdin JSON write functionality to HookExecutor in packages/agent-sdk/src/hooks/executor.ts
- [x] T006 [P] Update HookManager to pass extended context in packages/agent-sdk/src/hooks/manager.ts
- [x] T007 [P] Build and validate agent-sdk package with pnpm build

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - PreToolUse Hook Data Access (Priority: P1) 🎯 MVP

**Goal**: Hooks receive JSON with session context, tool name, and tool input for PreToolUse events

**Independent Test**: `jq -r '.session_id, .transcript_path, .cwd, .hook_event_name, .tool_name, .tool_input'`

### Implementation for User Story 1

- [x] T008 [US1] Collect tool input data in aiManager PreToolUse execution in packages/agent-sdk/src/managers/aiManager.ts
- [x] T009 [US1] Pass sessionId and toolInput through extended context in packages/agent-sdk/src/managers/aiManager.ts
- [x] T010 [US1] Create PreToolUse hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [x] T011 [US1] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, PreToolUse hooks receive complete JSON data and can be tested with jq

---

## Phase 4: User Story 2 - PostToolUse Hook Response Analysis (Priority: P2)

**Goal**: Hooks receive JSON with tool input, tool response, and session context for PostToolUse events

**Independent Test**: `jq -r '.tool_input, .tool_response'`

### Implementation for User Story 2

- [x] T012 [US2] Collect tool response data in aiManager PostToolUse execution in packages/agent-sdk/src/managers/aiManager.ts
- [x] T013 [US2] Pass toolResponse through extended context in packages/agent-sdk/src/managers/aiManager.ts
- [x] T014 [US2] Add PostToolUse hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [x] T015 [US2] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, PostToolUse hooks receive tool input and response data and can be tested with jq

---

## Phase 5: User Story 3 - Session Access via Transcript Path (Priority: P2)

**Goal**: Hooks can access complete conversation history using transcript_path field

**Independent Test**: `jq -r '.transcript_path' | xargs cat | jq '.state.messages'`

### Implementation for User Story 3

- [x] T016 [US3] Implement session ID collection in Agent class in packages/agent-sdk/src/agent.ts
- [x] T017 [US3] Pass sessionId to all hook manager calls in packages/agent-sdk/src/agent.ts
- [x] T018 [US3] Add transcript path generation using getSessionFilePath in packages/agent-sdk/src/hooks/executor.ts
- [x] T019 [US3] Add session access example in packages/agent-sdk/examples/hook-json-input.ts
- [x] T020 [US3] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, hooks can access session data via transcript_path

---

## Phase 6: User Story 4 - UserPromptSubmit Hook Monitoring (Priority: P3)

**Goal**: Hooks receive user prompt text and session context for UserPromptSubmit events

**Independent Test**: `jq -r '.prompt'`

### Implementation for User Story 4

- [ ] T021 [US4] Collect user prompt data in Agent handleUserPrompt in packages/agent-sdk/src/agent.ts
- [ ] T022 [US4] Pass userPrompt through extended context in packages/agent-sdk/src/agent.ts
- [ ] T023 [US4] Add UserPromptSubmit hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [ ] T024 [US4] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: At this point, UserPromptSubmit hooks receive prompt text and session context

---

## Phase 7: User Story 5 - Stop Hook Cleanup Actions (Priority: P3)

**Goal**: Hooks receive minimal JSON for session termination with cleanup capabilities

**Independent Test**: `jq -r '.hook_event_name'`

### Implementation for User Story 5

- [ ] T025 [US5] Ensure Stop hook receives sessionId in aiManager stop execution in packages/agent-sdk/src/managers/aiManager.ts
- [ ] T026 [US5] Add Stop hook example script in packages/agent-sdk/examples/hook-json-input.ts
- [ ] T027 [US5] Run type-check and lint validation: pnpm run type-check && pnpm run lint

**Checkpoint**: All user stories should now be independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T028 [P] Complete hook-json-input.ts example with all event types in packages/agent-sdk/examples/hook-json-input.ts
- [ ] T029 [P] Test example execution with pnpm tsx examples/hook-json-input.ts
- [ ] T030 Add error handling for JSON construction failures in packages/agent-sdk/src/hooks/executor.ts
- [ ] T031 Add error handling for stdin write failures in packages/agent-sdk/src/hooks/executor.ts
- [ ] T032 Final type-check and lint validation: pnpm run type-check && pnpm run lint

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 but independently testable
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Enhances all stories but independently testable
- **User Story 4 (P3)**: Can start after Foundational (Phase 2) - Independent of other stories
- **User Story 5 (P3)**: Can start after Foundational (Phase 2) - Independent of other stories

### Within Each User Story

- Data collection before context passing
- Context modifications before example creation
- Implementation before validation
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- User Stories 1 and 2 can be developed in parallel as they modify different methods
- User Stories 4 and 5 can be developed in parallel as they are independent

---

## Parallel Example: User Story 1

```bash
# No parallel tasks within US1 - tasks are sequential due to dependencies:
# T008 (data collection) → T009 (context passing) → T010 (example) → T011 (validation)
```

---

## Parallel Example: Multiple User Stories

```bash
# After Foundational phase, these can run in parallel:
# US1: PreToolUse implementation (T008-T011)
# US4: UserPromptSubmit implementation (T021-T024) 
# US5: Stop implementation (T025-T027)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test PreToolUse hooks with jq independently
5. Demo PreToolUse JSON input functionality

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test with jq independently → Demo (MVP!)
3. Add User Story 2 → Test PostToolUse with jq independently → Demo
4. Add User Story 3 → Test session access with jq independently → Demo
5. Add User Story 4 → Test UserPromptSubmit with jq independently → Demo
6. Add User Story 5 → Test Stop hooks with jq independently → Demo
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (PreToolUse)
   - Developer B: User Story 4 (UserPromptSubmit) 
   - Developer C: User Story 5 (Stop)
3. Then proceed to User Stories 2 and 3 which build on the foundation
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable with jq
- Focus on concise testing using jq rather than comprehensive test suites
- Must run pnpm build after modifying agent-sdk before testing
- Must run type-check and lint after each story
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently with jq commands
- Backward compatibility maintained - existing hooks continue to work