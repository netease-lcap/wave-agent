# Tasks: Status Command

**Feature**: Status Command
**Branch**: `069-add-status-command`
**Status**: Draft

## Phase 1: Setup

- [X] T001 Verify project structure and design documents in `specs/069-add-status-command/`

## Phase 2: Foundational

- [X] T002 [P] Expose `getGatewayConfig` and `getModelConfig` in `packages/agent-sdk/src/agent.ts` if not already public
- [X] T003 [P] Update `ChatContextType` to include `getGatewayConfig`, `getModelConfig`, and `workingDirectory` in `packages/code/src/contexts/useChat.tsx`
- [X] T004 Update `ChatProvider` to provide the new metadata from the agent in `packages/code/src/contexts/useChat.tsx`

## Phase 3: User Story 1 - View Agent Status (Priority: P1)

**Goal**: Implement the `/status` command and its overlay UI.
**Independent Test**: Type `/status` in the CLI. Verify the overlay appears with correct metadata and the input box is hidden. Press `Esc` to dismiss.

- [X] T005 [P] [US1] Create `AgentStatus` interface in `packages/code/src/contracts/status.ts` (as defined in design)
- [X] T006 [P] [US1] Implement `StatusCommand.tsx` overlay component in `packages/code/src/components/StatusCommand.tsx`
- [X] T007 [US1] Add `showStatusCommand` state and `setShowStatusCommand` to `InputManager` in `packages/code/src/managers/InputManager.ts`
- [X] T008 [US1] Update `handleCommandSelect` in `packages/code/src/managers/InputManager.ts` to handle the "status" command
- [X] T009 [US1] Update `useInputManager` hook to expose `showStatusCommand` in `packages/code/src/hooks/useInputManager.ts`
- [X] T010 [US1] Integrate `StatusCommand` into `packages/code/src/components/InputBox.tsx` and ensure it conditionally renders
- [X] T011 [US1] Implement logic to hide the input box when `showStatusCommand` is true in `packages/code/src/components/InputBox.tsx`
- [X] T012 [US1] Add unit tests for `StatusCommand.tsx` in `packages/code/tests/components/StatusCommand.test.tsx`
- [X] T013 [US1] Add integration tests for `/status` command handling in `packages/code/tests/managers/InputManager.status.test.ts`

## Phase 4: Polish & Cross-cutting Concerns

- [X] T014 [P] Ensure long paths in `cwd` are handled gracefully (e.g., wrapping or truncation) in `packages/code/src/components/StatusCommand.tsx`
- [X] T015 Run `pnpm run type-check` and `pnpm run lint` across the monorepo
- [X] T016 Run `pnpm test:coverage` and ensure coverage is maintained or improved

## Dependencies

- Phase 2 must be completed before Phase 3.
- T006, T007, T008 can be worked on in parallel.
- T010 depends on T006 and T009.

## Parallel Execution Examples

- **User Story 1**:
  - Developer A: T006 (UI Component)
  - Developer B: T007, T008, T009 (Command Logic)

## Implementation Strategy

- **MVP**: Implement the basic `/status` command that shows the overlay with hardcoded or partial data to verify the UI flow.
- **Incremental**: Connect the real metadata from `agent-sdk` and refine the UI styling and edge case handling.
