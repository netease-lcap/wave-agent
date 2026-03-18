# Research: dontAsk Permission Mode

## Decision:
- Add `"dontAsk"` to `PermissionMode` union type in `packages/agent-sdk/src/types/permissions.ts`.
- Update `PermissionManager.checkPermission` in `packages/agent-sdk/src/managers/permissionManager.ts` to handle `dontAsk` mode by auto-denying restricted tools not in `permissions.allow` or `temporaryRules`.
- Update `packages/agent-sdk/src/prompts/index.ts` to inject the specified message into the system prompt when `dontAsk` mode is active.
- Ensure `cyclePermissionMode` in `packages/code/src/managers/inputHandlers.ts` excludes `"dontAsk"`.

## Rationale:
- `PermissionMode` is the central type for permission handling.
- `PermissionManager.checkPermission` is the core logic for tool authorization.
- System prompt injection ensures the agent is aware of the mode.
- Excluding from `cyclePermissionMode` prevents accidental activation via UI shortcut.

## Alternatives considered:
- Dedicated `get-permissions` tool: Rejected in favor of system prompt injection for proactive awareness.
- Listing all rules in prompt: Rejected to save tokens and avoid clutter.

## Research Tasks

- [x] Research `PermissionMode` definition and usage.
- [x] Research `PermissionManager.checkPermission` logic for `dontAsk` integration.
- [x] Research system prompt construction for message injection.
- [x] Research `cyclePermissionMode` in `packages/code` to exclude `dontAsk`.
