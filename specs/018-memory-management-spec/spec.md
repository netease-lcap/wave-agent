# Memory Management Specification

The Memory Management system allows the AI agent to persist important information across conversations and projects. It provides a way for users to explicitly "teach" the agent facts, preferences, or project-specific context.

## Overview

The system uses a dual-layer storage approach:
1.  **Project Memory**: Context specific to a single project/directory.
2.  **User Memory**: Global context that follows the user across all projects.

## Triggering and Saving

- **Trigger**: Any user input starting with the `#` character (e.g., `# Use pnpm instead of npm`).
- **Selection**: When a memory message is submitted, the `InputManager` activates a `MemoryTypeSelector`, allowing the user to choose between "Project" and "User" storage.
- **Formatting**: Memory entries are stored as bullet points (`- <content>`) in Markdown files.

## Storage Locations

### Project Memory
- **File**: `AGENTS.md`
- **Location**: Root of the current working directory.
- **Purpose**: Stores project-specific rules, architecture notes, or local preferences.

### User Memory
- **File**: Defined by `USER_MEMORY_FILE` (typically `~/.wave/memory.md`).
- **Location**: Global data directory (`~/.wave/`).
- **Purpose**: Stores user preferences, global coding styles, or cross-project information.

## Retrieval and AI Context

- **Combined Memory**: Before each AI request, the `AIManager` calls `getCombinedMemoryContent()`.
- **Merging**: This function reads both `AGENTS.md` and the global user memory file, concatenating them into a single context string.
- **Prompt Injection**: The combined memory is provided to the AI model, ensuring it has access to all relevant persisted information when generating a response.

## Key Components

- **`memory.ts` (Service)**: Handles the low-level file I/O for reading and writing memory files.
- **`InputManager.ts` (Manager)**: Detects the `#` trigger and manages the memory type selection UI.
- **`AIManager.ts` (Manager)**: Orchestrates the retrieval of memory to be included in the AI's system prompt.
