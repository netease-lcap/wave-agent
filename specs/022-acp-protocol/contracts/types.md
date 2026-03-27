# ACP Types

## Session Modes
- `default`: Ask for permission for restricted tools.
- `acceptEdits`: Automatically accept file edits.
- `plan`: Plan mode for complex tasks.
- `bypassPermissions`: Automatically accept all tool calls.
- `dontAsk`: Automatically deny restricted tools unless pre-approved.

## Permission Options
- `allow_once`: Allow the tool call once.
- `allow_always`: Allow the tool call and potentially change mode or add a rule.
- `reject_once`: Deny the tool call once.

## Tool Kinds
- `read`: Read-only tools (e.g., Read, Glob, Grep, LSP).
- `edit`: File modification tools (e.g., Write, Edit).
- `execute`: Command execution tools (e.g., Bash).
- `other`: Other tools (e.g., Agent).
