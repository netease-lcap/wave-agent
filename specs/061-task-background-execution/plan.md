# Implementation Plan: Task Background Execution

**Feature Branch**: `061-task-background-execution`  
**Created**: 2026-02-09  
**Status**: All phases implemented, tests pending for notifications

## Technical Context

### Architecture
- **SDK Layer**: `packages/agent-sdk` will host the `BackgroundTaskManager` which unifies `BackgroundBashManager` and background subagent execution.
- **Tool Layer**: `Task` and `TaskStop` tools will interface with the `BackgroundTaskManager`. Agents will use the `Read` tool to read the `outputPath` of background tasks.
- **CLI Layer**: `packages/code` will implement the `/tasks` slash command and remove `/bashes`.

### Dependencies
- `child_process`: For shell task execution.
- `SubagentManager`: For subagent task execution.
- `AIManager`: For controlling the AI loop of subagents.

### Constraints
- Must maintain backward compatibility for the `Bash` tool's `run_in_background` parameter.
- Must ensure subagents cannot recursively spawn other subagents (already handled in `Task` tool).

## Constitution Check

- **I. Package-First Architecture**: Changes are clearly separated between `agent-sdk` (logic/tools) and `code` (CLI).
- **II. TypeScript Excellence**: All new interfaces and classes will be strictly typed.
- **III. Test Alignment**: Unit tests for `BackgroundTaskManager` and integration tests for the new tools are required.
- **IX. Type System Evolution**: We will evolve `BackgroundShell` into a more generic `BackgroundTask` type.
- **X. Data Model Minimalism**: The `BackgroundTask` entity is kept to essential fields.
- **XI. Planning with General-Purpose Agent**: All research and design phases were performed using the general-purpose agent.

## Phase 0: Research
- [x] Research existing Task tool implementation.
- [x] Research background process handling in `BackgroundBashManager`.
- [x] Identify CLI command locations.
- [x] Generate `research.md`.

## Phase 1: Design & Contracts
- [x] Define `BackgroundTask` data model.
- [x] Define API contracts for `Task` and `TaskStop` tools.
- [x] Generate `quickstart.md`.

## Phase 2: Implementation Strategy

### Step 1: SDK Refactoring
- Create `BackgroundTaskManager` in `packages/agent-sdk/src/managers/`.
- Migrate logic from `BackgroundBashManager` to `BackgroundTaskManager`.
- Add support for subagent tasks in `BackgroundTaskManager`.

### Step 2: Tool Updates
- Update `Task` tool to support `run_in_background`.
- Implement `TaskStop` tool.
- Update `Bash` tool to use the new manager.
- Remove `BashOutput` and `KillBash` tools.
- Remove `TaskOutput` tool in favor of using the `Read` tool.

### Step 3: CLI Updates
- Implement `/tasks` command in `SlashCommandManager`.
- Remove `/bashes` command.
- Implement Ctrl-B backgrounding logic in `InputManager` and `Agent`.
- Update UI components in `packages/code` to handle the new task types and show Ctrl-B hint.

### Step 3.5: Task Completion Notifications
- Add `TaskNotificationBlock` type to `packages/agent-sdk/src/types/messaging.ts`.
- Create `notificationXml.ts` helpers for XML serialization/parsing.
- Add `addNotificationMessageToMessages` to `messageOperations.ts`.
- Add `addNotificationMessage` to `MessageManager` with callback.
- Update `agent.ts` and `aiManager.ts` to process notifications as structured blocks.
- Update `convertMessagesForAPI.ts` to convert `TaskNotificationBlock` back to XML.
- Create `TaskNotificationMessage` component for CLI rendering.
- Update `MessageBlockItem` to render notification blocks.

### Step 4: Verification
- Run `pnpm build` for `agent-sdk`.
- Run unit tests for the new manager and tools.
- Verify CLI commands in a live session.
