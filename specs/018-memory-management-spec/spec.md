# Feature Specification: Memory Management

**Feature Branch**: `018-memory-management-spec`  
**Created**: 2026-01-22  
**Status**: In Progress  
**Input**: User description: "Memory Management for persisting information across conversations"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save Project-Specific Memory (Priority: P1)

As a user, I want to save project-specific rules or context by typing `#` so the agent remembers them for this project.

**Why this priority**: This is the core functionality that allows the agent to adapt to different project requirements and styles.

**Independent Test**: Type `# Use pnpm instead of npm` in a project directory, select "Project" memory, and verify it's saved to `AGENTS.md`.

**Acceptance Scenarios**:

1. **Given** the user types a message starting with `#`, **When** they press `Enter`, **Then** a memory type selector MUST appear.
2. **Given** the selector is open, **When** the user selects "Project", **Then** the message MUST be saved to `AGENTS.md` in the current directory.
3. **Given** information is saved in `AGENTS.md`, **When** the agent is asked a related question, **Then** it MUST use that information in its response.

---

### User Story 2 - Save Global User Memory (Priority: P1)

As a user, I want to save global preferences that follow me across all projects so I don't have to repeat them.

**Why this priority**: Essential for a personalized experience across different workspaces.

**Independent Test**: Type `# My name is Alice`, select "User" memory, and verify it's saved to the global memory file (e.g., `~/.wave/memory.md`).

**Acceptance Scenarios**:

1. **Given** the memory type selector is open, **When** the user selects "User", **Then** the message MUST be saved to the global user memory file.
2. **Given** information is saved in global memory, **When** the agent is used in ANY project, **Then** it MUST have access to that information.

---

### User Story 3 - Manage Memory (Priority: P2)

As a user, I want to view and delete saved memory entries so I can keep my context accurate and up-to-date.

**Why this priority**: Prevents memory from becoming cluttered with outdated or incorrect information.

**Independent Test**: Open the memory management UI, find an entry, and delete it. Verify it's removed from the corresponding file.

**Acceptance Scenarios**:

1. **Given** the user opens the memory management UI, **Then** they MUST see a list of all project and user memory entries.
2. **Given** an entry is selected, **When** the user chooses to delete it, **Then** it MUST be removed from the storage file.

---

### User Story 4 - Auto Memory (Priority: P1)

As a user, I want the agent to automatically remember project-specific knowledge (conventions, architecture, preferences) without me having to manually save it every time.

**Why this priority**: Reduces friction in maintaining project context and ensures the agent learns from its interactions.

**Independent Test**: Start an agent session in a new project, verify that `~/.wave/projects/<encoded-path>/memory/MEMORY.md` is created. Add a rule to it and verify it's injected into the system prompt.

**Acceptance Scenarios**:

1. **Given** an agent session starts, **When** auto-memory is enabled, **Then** a project-specific memory directory MUST be created in `~/.wave/projects/`.
2. **Given** a `MEMORY.md` file exists in the auto-memory directory, **When** any agent (main or subagent) is initialized, **Then** the first 200 lines of this file MUST be injected into the system prompt.
3. **Given** the agent is performing file operations, **When** it accesses the auto-memory directory, **Then** these operations MUST be considered within the "Safe Zone" and not require manual confirmation in `acceptEdits` mode.

---

### Edge Cases

- **Missing storage files**: The system should create `AGENTS.md` or the global memory file if they don't exist.
- **Duplicate entries**: The system should ideally prevent or warn about duplicate memory entries.
- **Large memory files**: If memory files grow too large, the system should handle them efficiently (e.g., using RAG or summarization).
- **Concurrent access**: Handle cases where multiple agent instances might try to write to the same memory file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST trigger memory saving when a message starts with `#`.
- **FR-002**: System MUST provide a UI to choose between "Project" and "User" memory.
- **FR-003**: Project memory MUST be stored in `AGENTS.md` in the current working directory.
- **FR-004**: User memory MUST be stored in a global file (e.g., `~/.wave/memory.md`).
- **FR-005**: Memory entries MUST be stored in Markdown bullet point format.
- **FR-006**: System MUST combine project and user memory and include it in the AI's system prompt for every request.
- **FR-007**: System SHOULD provide a way to deduplicate memory entries.
- **FR-008**: System SHOULD provide a UI for viewing and deleting memory entries.
- **FR-009**: System MUST automatically create and manage a project-specific `MEMORY.md` file in `~/.wave/projects/<encoded-path>/memory/`.
- **FR-010**: System MUST inject the first 200 lines of the project-specific `MEMORY.md` into the system prompt for all agents.
- **FR-011**: System MUST consider the auto-memory directory as part of the "Safe Zone" for permission checks.
- **FR-012**: System MUST allow disabling auto-memory via `WAVE_DISABLE_AUTO_MEMORY=1` or `autoMemoryEnabled: false` in `settings.json`.

### Key Entities *(include if feature involves data)*

- **MemoryEntry**: A single piece of persisted information.
    - `content`: The text of the memory.
    - `type`: "Project" or "User".
    - `source`: The file path where it's stored.
- **MemorySelectorState**: The state of the memory type selector in `InputManager`.
    - `isActive`: Whether the selector is visible.
    - `message`: The memory content to be saved.

## Assumptions

- The user has write permissions to the current directory and the global `~/.wave/` directory.
- The AI model has a sufficient context window to include the combined memory.
- Markdown is the preferred format for human-readability and easy editing.
