# Tasks: btwAgent

**Input**: Design documents from `/specs/073-btw-agent/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Add `/btw` command definition to `packages/code/src/constants/commands.ts`
- [ ] T002 [P] Add `getSystemPrompt()` getter to `AIManager` in `packages/agent-sdk/src/managers/aiManager.ts`
- [ ] T003 [P] Rebuild `agent-sdk` using `pnpm -F wave-agent-sdk build` to make changes available to `code` package

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Extend `ChatContextType` with `btwAgent` state fields in `packages/code/src/contexts/useChat.tsx`
- [ ] T005 Initialize `btwAgent` state variables in `useChat` hook in `packages/code/src/contexts/useChat.tsx`
- [ ] T006 Implement `btwAgent` message and token change callbacks in `useChat.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Quick Query via /btw (Priority: P1) 🎯 MVP

**Goal**: Allow users to launch a `btwAgent` via `/btw <query>` that runs concurrently with the main agent and displays its own messages.

**Independent Test**: Type `/btw hello` and verify that a `btwAgent` is launched, the UI transitions, and the agent responds without interrupting the main agent.

### Tests for User Story 1 (REQUIRED) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T007 [P] [US1] Unit test for `/btw` command interception in `packages/code/tests/contexts/useChat.test.tsx`
- [ ] T008 [P] [US1] Integration test for `btwAgent` lifecycle (create, execute, message update) in `packages/code/tests/integration/btwAgent.test.ts`

### Implementation for User Story 1

- [ ] T009 [US1] Implement `/btw` command interception in `sendMessage` function in `packages/code/src/contexts/useChat.tsx` (MUST bypass `queuedMessages` check)
- [ ] T010 [US1] Implement `btwAgent` instance creation and execution logic in `useChat.tsx`
- [ ] T011 [US1] Implement `<system-reminder>` wrapping logic for `btwAgent` queries in `useChat.tsx`
- [ ] T012 [US1] Update `ChatInterface.tsx` (or equivalent UI component) to conditionally hide the input box when `isBtwModeActive` is true
- [ ] T013 [US1] Update message rendering logic to show `btwAgentMessages` when `isBtwModeActive` is true in `packages/code/src/components/ChatInterface.tsx`
- [ ] T014 [US1] Implement logic to hide `<system-reminder>` XML block from user-facing messages in `packages/code/src/components/MessageItem.tsx`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Dismissing btwAgent (Priority: P1)

**Goal**: Allow users to dismiss the `btwAgent` view and return to the main agent using Space, Enter, or Escape keys.

**Independent Test**: While in `btwAgent` mode, press `Escape` and verify the UI returns to the main agent view and the input box reappears.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T015 [P] [US2] Unit test for dismissal key handling in `packages/code/tests/contexts/useChat.test.tsx`

### Implementation for User Story 2

- [ ] T016 [US2] Implement dismissal key detection (Space, Enter, Escape) in `useInput` hook in `packages/code/src/contexts/useChat.tsx`
- [ ] T017 [US2] Implement `dismissBtwAgent` function to reset state and abort `btwAgent` in `useChat.tsx`
- [ ] T018 [US2] Display "Press Space, Enter, or Escape to dismiss" message at the bottom of the UI in `packages/code/src/components/ChatInterface.tsx`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T019 [P] Ensure `abortMessage` correctly handles both main agent and `btwAgent` in `useChat.tsx`
- [ ] T020 [P] Ensure `clearMessages` correctly resets `btwAgent` state in `useChat.tsx`
- [ ] T021 [P] Verify `pnpm test:coverage` maintains or improves coverage
- [ ] T022 Run `quickstart.md` validation to ensure user instructions are accurate

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2).
- **User Story 2 (P2)**: Can start after Foundational (Phase 2). Depends on US1 for the "active" state to dismiss.

### Parallel Opportunities

- T002 and T003 can run in parallel with T001.
- T007 and T008 can run in parallel.
- T012, T013, and T014 can run in parallel (different UI components).
- T015 can run in parallel with US1 implementation.

---

## Implementation Strategy

### Task Delegation (CRITICAL)
Tasks in this file MUST be delegated to subagents whenever possible to reduce context costs of the main agent.
- Use `Explore` for codebase research.
- Use `general-purpose` for complex implementation tasks.

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready.
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently.
4. Each story adds value without breaking previous stories.
