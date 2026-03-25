# Tasks: ACP Bridge Implementation

## Phase 1: Core ACP Infrastructure (Completed)

- [x] **Task 1**: Implement ACP NDJSON stream handling over `stdin`/`stdout`.
- [x] **Task 2**: Implement `WaveAcpAgent` class to bridge ACP methods to `WaveAgent`.
- [x] **Task 3**: Implement `initialize` and `authenticate` methods.
- [x] **Task 4**: Implement session management: `newSession`, `loadSession`, `listSessions`, and `unstable_closeSession`.

## Phase 2: Messaging and Tooling (Completed)

- [x] **Task 5**: Implement `prompt` method for text and image inputs.
- [x] **Task 6**: Implement `cancel` notification for aborting messages.
- [x] **Task 7**: Implement `sessionUpdate` notifications for assistant content and reasoning chunks.
- [x] **Task 8**: Implement `sessionUpdate` notifications for tool calls and status updates.
- [x] **Task 9**: Implement `requestPermission` for tool execution control.
- [x] **Task 10**: Implement diff generation for `Write` and `Edit` tool calls in ACP.

## Phase 3: Advanced Features (Completed)

- [x] **Task 11**: Implement `plan` updates for task list synchronization.
- [x] **Task 12**: Implement permission mode management (`setSessionMode`, `setSessionConfigOption`).
- [x] **Task 13**: Implement `available_commands_update` for slash command discovery.
- [x] **Task 14**: Implement cleanup of all active agents on connection closure.

## Phase 4: Refinements (Completed)

- [x] **Task 15**: Implement special handling for `ExitPlanMode` tool calls in ACP bridge.
- [x] **Task 16**: Include `plan_content` in `ExitPlanMode` tool call content for ACP clients.
- [x] **Task 17**: Implement `resource_link` and `resource` block handling in `prompt` method.
- [x] **Task 18**: Advertise `image` and `embeddedContext` in `promptCapabilities` during initialization.
- [x] **Task 19**: Improve block joining in `prompt` method to preserve inline spacing.
