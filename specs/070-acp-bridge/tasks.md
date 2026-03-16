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
