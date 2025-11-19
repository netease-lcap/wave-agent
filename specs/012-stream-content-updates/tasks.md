# Tasks: Real-Time Content Streaming

**Input**: Design documents from `/specs/012-stream-content-updates/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included following TDD workflow as specified in plan.md constitution check.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create streaming utilities structure in packages/agent-sdk/src/utils/streamingHelpers.ts
- [X] T002 [P] Verify pnpm build works after agent-sdk modifications
- [X] T003 [P] Setup TypeScript types for streaming interfaces in packages/agent-sdk/src/types/index.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core streaming infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement extractCompleteParams utility function in packages/agent-sdk/src/utils/streamingHelpers.ts
- [X] T005 [P] Write unit tests for extractCompleteParams in packages/agent-sdk/tests/utils/streamingHelpers.test.ts
- [X] T006 Enhance MessageManagerCallbacks interface in packages/agent-sdk/src/managers/messageManager.ts
- [X] T007 [P] Enhance CallAgentOptions interface in packages/agent-sdk/src/services/aiService.ts  
- [X] T008 [P] Add streaming type definitions in packages/agent-sdk/src/types/index.ts
- [X] T009 Build agent-sdk package to verify type safety with pnpm build

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Real-time Assistant Message Streaming (Priority: P1) 🎯 MVP

**Goal**: Users experience immediate, incremental updates to assistant responses as they are being generated, similar to ChatGPT's typing effect.

**Independent Test**: Can be fully tested by sending any message to the assistant and observing that the response text appears incrementally character by character, rather than appearing all at once after completion.

### Tests for User Story 1 ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T010 [P] [US1] Write unit test for callAgent streaming content in packages/agent-sdk/tests/services/aiService.test.ts
- [X] T011 [P] [US1] Write integration test for Agent content streaming in packages/agent-sdk/tests/agent/agent.streaming.test.ts

### Implementation for User Story 1

- [X] T012 [US1] Implement streaming support in callAgent function in packages/agent-sdk/src/services/aiService.ts
- [X] T013 [US1] Add updateCurrentMessageContent method to MessageManager in packages/agent-sdk/src/managers/messageManager.ts
- [X] T014 [US1] Integrate streaming callbacks in AIManager.sendAIMessage in packages/agent-sdk/src/managers/aiManager.ts
- [X] T015 [US1] Add onAssistantContentUpdated callback handling in packages/agent-sdk/src/managers/messageManager.ts (signature: triggerContentUpdate(chunk: string, accumulated: string))
- [X] T016 [US1] Modify onAssistantMessageAdded signature to () => void and update all call sites in packages/agent-sdk/src/managers/messageManager.ts
- [X] T017 [US1] Build agent-sdk with `pnpm build` and verify streaming exports are available for import in code package
- [X] T018 [US1] Add onAssistantContentUpdated callback usage in packages/code/src/print-cli.ts for logging chunks (example implementation only)
- [X] T018a [US1] Add text encoding preservation handling in streaming content updates (ensure OpenAI API chunks are complete UTF-8 strings before display - OpenAI already handles UTF-8 boundaries correctly in their streaming API)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Real-time Tool Parameter Streaming (Priority: P2)

**Goal**: Users see tool call parameters being built incrementally as the AI constructs function calls, providing transparency into the AI's reasoning process.

**Independent Test**: Can be tested by requesting an action that triggers tool calls and observing that parameters appear incrementally in collapsed view, while expanded view shows snapshot of parameters from when expanded mode was entered.

### Tests for User Story 2 ⚠️

- [X] T019 [P] [US2] Write unit test for tool parameter streaming in packages/agent-sdk/tests/services/aiService.test.ts
- [X] T020 [P] [US2] Write integration test for tool parameter updates in packages/agent-sdk/tests/agent/agent.streaming.test.ts

### Implementation for User Story 2

- [X] T021 [US2] Add parametersChunk field to AgentToolBlockUpdateParams interface in packages/agent-sdk/src/utils/messageOperations.ts
- [X] T022 [US2] Implement tool call parameter streaming in callAgent function in packages/agent-sdk/src/services/aiService.ts
- [X] T023 [US2] Add updateToolParameters method to MessageManager in packages/agent-sdk/src/managers/messageManager.ts
- [X] T024 [US2] Enhance onToolBlockUpdated callback for streaming parameters in packages/agent-sdk/src/managers/messageManager.ts
- [X] T025 [US2] Integrate tool parameter streaming in AIManager.sendAIMessage using existing generateCompactParams to compute compactParams for streaming updates and include in onToolBlockUpdated callback data for both view modes in packages/agent-sdk/src/managers/aiManager.ts
- [X] T026 [US2] Build agent-sdk and verify tool streaming exports
- [X] T027 [US2] Add onToolBlockUpdated callback usage with parametersChunk field in packages/code/src/print-cli.ts for logging tool parameters (example implementation only)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Seamless View Mode Transitions (Priority: P3)

**Goal**: Users can switch between collapsed and expanded view modes, where collapsed mode shows real-time streaming and expanded mode shows completely static content without any updates during content generation.

**Independent Test**: Can be tested by triggering streaming content and toggling between collapsed/expanded modes during the streaming process.

### Tests for User Story 3 ⚠️

- [ ] T028 [P] [US3] Write unit test for view mode transition logic in packages/code/tests/contexts/useChat.streaming.test.ts
- [ ] T029 [P] [US3] Write integration test for view mode streaming behavior in packages/code/tests/components/MessageList.streaming.test.ts

### Implementation for User Story 3

- [ ] T030 [US3] Add view mode control logic to useChat context in packages/code/src/contexts/useChat.tsx
- [ ] T031 [US3] Implement conditional message updates based on isExpandedRef in packages/code/src/contexts/useChat.tsx
- [ ] T032 [US3] Update MessageList component to handle streaming in different view modes in packages/code/src/components/MessageList.tsx
- [ ] T033 [P] [US3] Add streaming utilities for CLI interface in packages/code/src/utils/streamingUtils.ts
- [ ] T034 [US3] Integrate view mode transitions with streaming callbacks in packages/code/src/contexts/useChat.tsx

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T035 [P] Run quickstart.md validation to ensure implementation matches guide
- [ ] T036 Code cleanup and remove any temporary debugging code
- [ ] T037 Final integration testing across all three user stories

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 streaming foundation but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Integrates with US1/US2 but independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Utilities before core services  
- Services before manager integration
- Manager integration before CLI interface
- Core implementation before view mode integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Utility functions within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Write unit test for callAgent streaming content in packages/agent-sdk/tests/services/aiService.test.ts"
Task: "Write integration test for Agent content streaming in packages/agent-sdk/tests/agent/agent.streaming.test.ts"

# After foundational phase, these can be worked on by different developers:
Task: "Implement streaming support in callAgent function"
Task: "Add onAssistantContentUpdated callback handling"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo basic streaming functionality

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP - Basic content streaming!)
3. Add User Story 2 → Test independently → Deploy/Demo (Enhanced with tool parameters)
4. Add User Story 3 → Test independently → Deploy/Demo (Complete with view modes)
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Content streaming)
   - Developer B: User Story 2 (Tool parameter streaming)  
   - Developer C: User Story 3 (View mode transitions)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD workflow)
- Run `pnpm build` in packages/agent-sdk after modifications before testing in packages/code
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Follow existing patterns in codebase for MessageManagerCallbacks and useChat context
- All streaming functionality leverages existing Message structures (no new entities)