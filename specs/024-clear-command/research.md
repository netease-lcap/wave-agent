# Research: Clear Command Move to SDK

## Context
The "clear" command was previously handled manually in the CLI (packages/code). This research explores the benefits and implications of moving it to the SDK.

## Benefits
- **Consistency**: Moving the `clear` command to the SDK ensures that it is handled consistently across all consumers of the SDK.
- **First-Class Feature**: Making the `clear` command a first-class feature of the SDK allows it to be easily integrated into other tools and applications.
- **Simplified CLI**: Moving the core logic of clearing messages and syncing the task list to the SDK simplifies the CLI and reduces its complexity.
- **Programmatic Access**: Providing an async `clearMessages()` method in the `Agent` class allows the `clear` command to be easily called programmatically.

## Implications
- **Async `clearMessages()`**: The `clearMessages()` method in the `Agent` class is now async, which may require updates to internal or external callers.
- **CLI Reaction**: The CLI must still react to the `sessionId` change triggered by the SDK to clear the terminal screen and remount the chat interface.
- **Task List Sync**: The SDK must ensure that the task list is correctly synchronized with the new session ID when the `clear` command is executed.

## Conclusion
Moving the `clear` command to the SDK is a beneficial change that improves consistency, simplifies the CLI, and provides programmatic access to a core feature.
