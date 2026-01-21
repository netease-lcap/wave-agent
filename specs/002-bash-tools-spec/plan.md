# Implementation Plan: Bash Tools

**Feature**: Bash Tools
**Status**: Completed

## Summary
Implement tools for executing shell commands, supporting both foreground and background execution. These tools provide the agent with terminal access for tasks that cannot be handled by specialized tools.

## Technical Context
- **Language**: TypeScript
- **Dependencies**: `child_process` (spawn)
- **Platform**: Cross-platform (Node.js)

## Project Structure
- `packages/agent-sdk/src/tools/bashTool.ts`: Implementation of `Bash`, `BashOutput`, and `KillBash`.
- `packages/agent-sdk/src/managers/backgroundBashManager.ts`: Management of background processes.

## Implementation Phases
1. **Phase 1: Foreground Execution**: Implement basic `Bash` tool with timeout and output capture.
2. **Phase 2: Background Support**: Implement `run_in_background` and `BackgroundBashManager`.
3. **Phase 3: Process Monitoring**: Implement `BashOutput` for retrieving background output.
4. **Phase 4: Process Control**: Implement `KillBash` for terminating background tasks.
5. **Phase 5: Safety & UX**: Add ANSI color stripping, output truncation, and permission checks.
