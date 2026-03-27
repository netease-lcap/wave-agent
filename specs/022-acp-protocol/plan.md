# Plan: ACP Implementation

## Phase 1: Core Protocol
- [x] Implement `initialize` and `authenticate`.
- [x] Implement session management (`newSession`, `loadSession`, `listSessions`).
- [x] Implement `prompt` and `cancel`.

## Phase 2: Tool Integration
- [x] Implement `handlePermissionRequest`.
- [x] Map tool calls to ACP `tool_call` updates.
- [x] Support diff-based content for file operations.

## Phase 3: Mode Transitions
- [x] Support `setSessionMode` and `setSessionConfigOption`.
- [x] Implement mode transitions for `ExitPlanMode` tool.
- [x] Ensure `allow_always` for `ExitPlanMode` switches to `acceptEdits` mode.
