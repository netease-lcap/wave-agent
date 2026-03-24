# Tasks: /btw Side Question

**Feature**: /btw Side Question
**Branch**: `073-btw-side-question`
**Implementation Strategy**: MVP first (User Story 1), then incremental delivery of follow-up support (User Story 2).

## Phase 1: Setup

- [x] T001 Add `BTW_SUBAGENT_SYSTEM_PROMPT` to `packages/agent-sdk/src/prompts/index.ts`
- [x] T002 Export `BTW_SUBAGENT_SYSTEM_PROMPT` in `packages/agent-sdk/src/prompts/index.ts`
- [x] T003 Add `btw` command definition to `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts`

## Phase 2: Foundational

- [x] T004 Implement `BtwManager` in `packages/agent-sdk/src/managers/btwManager.ts` to handle side agent lifecycle
- [x] T005 Add `btw()` and `dismissSideAgent()` to `Agent` class in `packages/agent-sdk/src/agent.ts`
- [x] T006 Add `sideMessages` state to `useChat` context in `packages/code/src/contexts/useChat.tsx`

## Phase 3: User Story 1 - Ask a side question while the main agent is working (Priority: P1)

**Goal**: Enable non-blocking side questions with UI switching.
**Independent Test**: Start a long-running task, type `/btw <question>`, verify side agent responds in a new view, and main agent continues.

- [x] T007 [P] [US1] Implement UI switching logic in `packages/code/src/components/ChatInterface.tsx` to show side agent messages
- [x] T008 [P] [US1] Update `LoadingIndicator.tsx` to show "Side agent is thinking" and hide other loading indicators when side agent is active
- [x] T009 [US1] Implement Space, Enter, and Escape key listeners in `SideAgentTip.tsx` to call `dismissSideAgent()`
- [x] T010 [US1] Integrate `/btw` command in `useChat.tsx` to trigger the side agent flow and track `isSideAgentThinking`
- [x] T011 [US1] Create `SideAgentTip.tsx` to show dismissal instructions
- [x] T012 [US1] Add `isSideAgentActive` derived state to `useChat` context
- [x] T013 [US2] Update `BtwManager` to use isolated `MessageManager` and `AIManager` with no tools
- [x] T014 [US2] Implement follow-up message handling in `useChat.tsx` when `sideMessages` is present
- [x] T015 [US2] Ensure side agent inherits `stream` configuration from main agent via `AIManager` method
- [x] T017 Run `pnpm build` to validate the implementation
- [x] T018 Verify `/btw` works as expected in the CLI

## Dependencies

- Phase 1 & 2 must be completed before Phase 3.
- Phase 3 (US1) must be completed before Phase 4 (US2).

## Parallel Execution Examples

- **US1**: T007 and T008 can be worked on in parallel as they both involve UI changes in `ChatInterface.tsx`.
- **Setup**: T001, T002, and T003 can be worked on in parallel.
