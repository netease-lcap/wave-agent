# Quickstart: Clear Command Move to SDK

## Overview
The `clear` command is now a first-class feature of the SDK. This guide provides a quick overview of how to use it.

## Using the CLI
To clear the conversation history and reset the session in the CLI, type:
```bash
/clear
```
This will:
1. Abort any ongoing AI message processing.
2. Clear the conversation history.
3. Generate a new session ID.
4. Reset the task list.
5. Clear the terminal screen.

## Using the SDK
To clear the conversation history and reset the session programmatically in the SDK, call:
```typescript
await agent.clearMessages();
```
This will perform the same actions as typing `/clear` in the CLI.

## Verification
To verify that the `clear` command is working correctly, you can:
1. Start the Wave Agent CLI.
2. Type some messages to populate the history.
3. Type `/clear` and press Enter.
4. Verify that the terminal screen is cleared and the message history is reset.
