# Spec: Clear Command in SDK

## Overview
The `clear` command is a core feature that resets the conversation history and session. It is implemented as a built-in slash command in the `SlashCommandManager` within `packages/agent-sdk`.

## Goals
- Provide a consistent way to clear messages and sync the task list via the SDK.
- Ensure the CLI can react to session resets (e.g., by clearing the terminal).
- Make the `clear` command available to all consumers of the SDK.
- Ensure programmatic calls to `clearMessages()` have the same effect as typing `/clear`.

## Architecture
The `clear` command is registered as a built-in slash command in the SDK. When executed, it performs the following actions:
1. Aborts any ongoing AI message processing.
2. Clears the conversation history and generates a new session ID.
3. Synchronizes the task list with the new session ID.

The CLI (packages/code) reacts to the `sessionId` change by clearing the terminal screen and remounting the chat interface.

## Components

### SDK (agent-sdk)
- **SlashCommandManager**: Registers the `clear` command and handles its execution.
- **Agent**: Provides an async `clearMessages()` method that delegates to the `clear` slash command.

### CLI (code)
- **App Component**: Reacts to `sessionId` changes to clear the terminal.

## User Experience
- Typing `/clear` in the CLI resets the conversation and clears the screen.
- Programmatic calls to `agent.clearMessages()` in the SDK perform the same reset.
