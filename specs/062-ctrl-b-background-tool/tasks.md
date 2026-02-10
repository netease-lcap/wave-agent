# Tasks: Ctrl-B Background Tool

**Feature**: Ctrl-B Background Tool
**Implementation Strategy**: MVP first (Bash tool backgrounding), then extend to Task tool. Focus on the handoff mechanism in `BackgroundTaskManager` and `SubagentManager` to ensure processes are not aborted.

## Phase 1: Setup & Foundational

- [ ] T001 Define `ForegroundTask` interface and `activeForegroundTasks` stack in `packages/agent-sdk/src/agent.ts`
- [ ] T002 Implement `registerForegroundTask` and `unregisterForegroundTask` methods in `packages/agent-sdk/src/agent.ts`
- [ ] T003 Implement `backgroundCurrentTask` method in `packages/agent-sdk/src/agent.ts` to pop the latest task and call its `backgroundHandler`
- [ ] T004 [P] Add `onBackgroundCurrentTask` callback to `AgentCallbacks` in `packages/agent-sdk/src/agent.ts`
- [ ] T005 [P] Update `InputManager` to detect `Ctrl-B` and trigger `onBackgroundCurrentTask` in `packages/code/src/managers/InputManager.ts`

## Phase 2: User Story 1 - Backgrounding a Bash Tool (P1)

**Goal**: Allow users to background a running bash tool without aborting the process.
**Test**: Run `sleep 60` via bash tool, press `Ctrl-B`, verify tool ends with "backgrounded" message and task appears in `/tasks`.

- [ ] T006 Update `BackgroundTaskManager.runShell` to return an object containing the `childProcess` and a `detach` function in `packages/agent-sdk/src/managers/backgroundTaskManager.ts`
- [ ] T007 Implement `adoptProcess` in `BackgroundTaskManager` to take an existing `childProcess` and manage it as a background task in `packages/agent-sdk/src/managers/backgroundTaskManager.ts`
- [ ] T008 Update `BashTool` to register itself as a foreground task and provide a `backgroundHandler` that calls `detach` and `adoptProcess` in `packages/agent-sdk/src/tools/bashTool.ts`
- [ ] T009 [P] Update `useChat` hook to handle `onBackgroundCurrentTask` and call `agent.backgroundCurrentTask()` in `packages/code/src/contexts/useChat.tsx`
- [ ] T010 [P] Implement UI hint `[Ctrl-B] Background` in the tool execution block when a backgroundable tool is active in `packages/code/src/components/ToolBlock.tsx`
- [ ] T010.1 Run `pnpm run type-check` and `pnpm lint` to validate Phase 2 changes

## Phase 3: User Story 2 - Backgrounding a Task Tool (P2)

**Goal**: Allow users to background a running subagent task.
**Test**: Start a complex task, press `Ctrl-B`, verify main agent is unblocked and subagent continues in background.

- [ ] T011 Update `SubagentManager` to support transitioning an active `SubagentInstance` to a background task in `packages/agent-sdk/src/managers/subagentManager.ts`
- [ ] T012 Update `TaskTool` to register itself as a foreground task and provide a `backgroundHandler` that transitions the subagent to background in `packages/agent-sdk/src/tools/taskTool.ts`
- [ ] T012.1 Run `pnpm run type-check` and `pnpm lint` to validate Phase 3 changes

## Phase 4: Polish & Edge Cases

- [ ] T013 Ensure `Agent.executeBashCommand` (for `!command`) does NOT register as a backgroundable foreground task in `packages/agent-sdk/src/agent.ts`
- [ ] T014 Add unit tests for `Agent.backgroundCurrentTask` logic in `packages/agent-sdk/tests/agent.test.ts`
- [ ] T014.1 Add integration tests for Bash and Task backgrounding in `packages/agent-sdk/tests/integration/backgrounding.test.ts`
- [ ] T014.2 Create functional example for backgrounding in `packages/agent-sdk/examples/backgrounding-demo.ts`
- [ ] T015 Verify race condition where tool finishes exactly when `Ctrl-B` is pressed
- [ ] T016 [P] Final lint and type-check across `agent-sdk` and `code` packages

## Dependencies

- Phase 1 must be completed before Phase 2 and 3.
- T006 and T007 are prerequisites for T008.
- T011 is a prerequisite for T012.

## Parallel Execution Examples

- **Setup**: T004 and T005 can be done in parallel with T001-T003.
- **Bash Tool**: T009 and T010 can be done in parallel with T006-T008.
- **Polish**: T014 and T016 can be done in parallel.
