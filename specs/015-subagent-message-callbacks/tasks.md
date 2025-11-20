# Tasks: Subagent Message Callbacks

**Input**: Design documents from `/specs/015-subagent-message-callbacks/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, contracts/ ✅

**Tests**: Tests are not explicitly requested in the feature specification, so this implementation focuses on direct functionality.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo structure**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- All changes contained within the existing `agent-sdk` package

## Codebase Analysis Summary

**Current State**:
- MessageManagerCallbacks interface exists in `packages/agent-sdk/src/managers/messageManager.ts` (lines 32-73)
- SubagentManager has callback forwarding via `subagentCallbacks` parameter (lines 133-145)  
- Existing callbacks: `onUserMessageAdded`, `onAssistantMessageAdded`, `onAssistantContentUpdated`, `onToolBlockUpdated`
- Callbacks are called directly in methods (e.g., line 282: `this.callbacks.onUserMessageAdded?.(params)`)
- No separate callback execution helpers needed

**Implementation Strategy**: Extend existing patterns with new `onSubagent*` callbacks

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create test directory structure for subagent callbacks in packages/agent-sdk/tests/managers/
- [x] T002 [P] Set up TypeScript compilation for modified interface files
- [x] T003 [P] Configure test environment for callback testing with vitest mocking

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core interface extensions that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

**Current Analysis**:
- MessageManagerCallbacks interface exists at lines 32-73 in messageManager.ts
- SubagentManager createInstance() method at lines 111-203 already forwards parent callbacks
- Existing pattern: callbacks called directly in methods (no helper methods needed)

- [x] T004 Add new onSubagent* callback types to existing MessageManagerCallbacks interface in packages/agent-sdk/src/managers/messageManager.ts
- [x] T005 [P] Modify SubagentManager.createInstance() to include subagent callback forwarding in packages/agent-sdk/src/managers/subagentManager.ts  
- [x] T006 Create base test utilities for callback verification in packages/agent-sdk/tests/utils/callbackTestUtils.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel ✅

---

## Phase 3: User Story 1 - Granular Subagent User Message Events (Priority: P1) 🎯 MVP

**Goal**: Enable tracking when subagents add user messages with subagent ID and message parameters

**Independent Test**: Create a subagent, send it a message, verify onSubagentUserMessageAdded callback receives the correct subagent ID and message parameters

**Implementation Pattern**: Follow existing `onUserMessageAdded` callback pattern at line 282 in messageManager.ts

### Implementation for User Story 1

- [x] T007 [US1] Add onSubagentUserMessageAdded callback invocation to MessageManager.addUserMessage method in packages/agent-sdk/src/managers/messageManager.ts
- [x] T008 [US1] Update SubagentManager.createInstance() subagentCallbacks to forward onSubagentUserMessageAdded in packages/agent-sdk/src/managers/subagentManager.ts  
- [x] T009 [US1] Add unit test for onSubagentUserMessageAdded callback in packages/agent-sdk/tests/managers/messageManager/subagentCallbacks.test.ts
- [x] T010 [US1] Add integration test for subagent user message forwarding in packages/agent-sdk/tests/managers/subagentManager/callbackIntegration.test.ts

**Checkpoint**: User Story 1 should be fully functional - subagent user message callbacks work independently

---

## Phase 4: User Story 2 - Granular Subagent Assistant Message Events (Priority: P1)

**Goal**: Enable detection when subagents start generating assistant responses for proper loading states

**Independent Test**: Trigger a subagent AI response, verify onSubagentAssistantMessageAdded callback fires when assistant message is created

**Implementation Pattern**: Follow existing `onAssistantMessageAdded` callback pattern at line 305 in messageManager.ts

### Implementation for User Story 2

- [x] T011 [US2] Add onSubagentAssistantMessageAdded callback invocation to MessageManager.addAssistantMessage method in packages/agent-sdk/src/managers/messageManager.ts
- [x] T012 [US2] Update SubagentManager.createInstance() subagentCallbacks to forward onSubagentAssistantMessageAdded in packages/agent-sdk/src/managers/subagentManager.ts
- [x] T013 [US2] Add unit test for onSubagentAssistantMessageAdded callback in packages/agent-sdk/tests/managers/messageManager/subagentCallbacks.test.ts
- [x] T014 [US2] Add integration test for subagent assistant message forwarding in packages/agent-sdk/tests/managers/subagentManager/callbackIntegration.test.ts

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Granular Subagent Content Streaming (Priority: P2)

**Goal**: Enable real-time streaming updates for subagent assistant content with live text streaming

**Independent Test**: Trigger subagent AI streaming response, verify onSubagentAssistantContentUpdated receives chunks and accumulated content with subagent ID

**Implementation Pattern**: Follow existing `onAssistantContentUpdated` callback pattern at line 573 in messageManager.ts

### Implementation for User Story 3

- [x] T015 [US3] Add onSubagentAssistantContentUpdated callback invocation to MessageManager.updateCurrentMessageContent method in packages/agent-sdk/src/managers/messageManager.ts
- [x] T016 [US3] Update SubagentManager.createInstance() subagentCallbacks to forward onSubagentAssistantContentUpdated in packages/agent-sdk/src/managers/subagentManager.ts
- [x] T017 [US3] Add unit test for onSubagentAssistantContentUpdated callback in packages/agent-sdk/tests/managers/messageManager/subagentCallbacks.test.ts
- [x] T018 [US3] Add integration test for subagent content streaming forwarding in packages/agent-sdk/tests/managers/subagentManager/callbackIntegration.test.ts

**Checkpoint**: User Stories 1, 2 AND 3 should all work independently

---

## Phase 6: User Story 4 - Granular Subagent Tool Usage Tracking (Priority: P2)

**Goal**: Enable monitoring when subagents use tools for detailed activity monitoring and debugging

**Independent Test**: Have a subagent execute a tool, verify onSubagentToolBlockUpdated receives tool parameters with subagent ID

**Implementation Pattern**: Follow existing `onToolBlockUpdated` callback pattern at line 355 in messageManager.ts

### Implementation for User Story 4

- [x] T019 [US4] Add onSubagentToolBlockUpdated callback invocation to MessageManager.updateToolBlock method in packages/agent-sdk/src/managers/messageManager.ts
- [x] T020 [US4] Update SubagentManager.createInstance() subagentCallbacks to forward onSubagentToolBlockUpdated in packages/agent-sdk/src/managers/subagentManager.ts
- [x] T021 [US4] Add unit test for onSubagentToolBlockUpdated callback in packages/agent-sdk/tests/managers/messageManager/subagentCallbacks.test.ts
- [x] T022 [US4] Add integration test for subagent tool block forwarding in packages/agent-sdk/tests/managers/subagentManager/callbackIntegration.test.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure robustness

- [ ] T023 [P] Add backward compatibility verification tests in packages/agent-sdk/tests/managers/backwardCompatibility.test.ts
- [ ] T024 [P] Add error handling tests for callback execution failures in packages/agent-sdk/tests/managers/errorHandling.test.ts
- [ ] T025 Add comprehensive callback cleanup tests in packages/agent-sdk/tests/managers/callbackCleanup.test.ts
- [ ] T026 [P] Validate TypeScript compilation with new interfaces
- [ ] T027 [P] Run quickstart.md validation examples

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P2)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories  
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Callback invocation in MessageManager before forwarding in SubagentManager
- Unit tests can be written in parallel with implementation
- Integration tests after both MessageManager and SubagentManager changes
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Different user stories can be worked on in parallel by different team members

---

## Implementation Strategy

### MVP First (User Story 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (User Message Events)
4. Complete Phase 4: User Story 2 (Assistant Message Events)
5. **STOP and VALIDATE**: Test both P1 user stories independently
6. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (Basic subagent events!)
3. Add User Story 2 → Test independently → Deploy/Demo (Complete P1 functionality!)
4. Add User Story 3 → Test independently → Deploy/Demo (Add streaming!)
5. Add User Story 4 → Test independently → Deploy/Demo (Complete monitoring!)
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (User Messages)
   - Developer B: User Story 2 (Assistant Messages)  
   - Developer C: User Story 3 (Content Streaming)
   - Developer D: User Story 4 (Tool Tracking)
3. Stories complete and integrate independently

---

## Implementation Notes

**Key Patterns from Existing Code**:
- Callbacks defined in MessageManagerCallbacks interface (messageManager.ts:32-73)
- Direct callback invocation pattern: `this.callbacks.onCallbackName?.(params)`
- SubagentManager forwards parent callbacks via subagentCallbacks parameter
- No separate helper methods needed - follow existing direct invocation pattern

**Changes Required**:
1. **Add 4 new callback types** to MessageManagerCallbacks interface
2. **Add 4 callback invocations** to existing MessageManager methods
3. **Update SubagentManager.createInstance()** to forward the new callbacks
4. **All changes are purely additive** - no existing code modification needed

**Task Count Reduction**: 27 tasks (reduced from 28) - removed unnecessary callback helper methods

**Focus**: Extend existing proven patterns rather than creating new infrastructure