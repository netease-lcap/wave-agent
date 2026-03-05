# Feature Specification: Memory Management

**Feature Branch**: `018-memory-management-spec`  
**Created**: 2026-01-22  
**Status**: In Progress  
**Input**: User description: "Memory Management for persisting information across conversations"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save Project-Specific Memory (Priority: P1)

As a user, I want the agent to save project-specific rules or context so it remembers them for this project.

**Why this priority**: This is the core functionality that allows the agent to adapt to different project requirements and styles.

**Independent Test**: Ask the agent to remember a project-specific rule (e.g., "always use pnpm") and verify it's saved to `AGENTS.md`.

**Acceptance Scenarios**:

1. **Given** the user asks the agent to remember something for the project, **When** the agent identifies it as a project rule, **Then** it MUST be saved to `AGENTS.md` in the current directory.
2. **Given** information is saved in `AGENTS.md`, **When** the agent is asked a related question, **Then** it MUST use that information in its response.

---

### User Story 2 - Save Global User Memory (Priority: P1)

As a user, I want the agent to save global preferences that follow me across all projects so I don't have to repeat them.

**Why this priority**: Essential for a personalized experience across different workspaces.

**Independent Test**: Ask the agent to remember a global preference (e.g., "my name is Alice") and verify it's saved to the global memory file (e.g., `~/.wave/AGENTS.md`).

**Acceptance Scenarios**:

1. **Given** the user asks the agent to remember something globally, **When** the agent identifies it as a user preference, **Then** it MUST be saved to the global user memory file.
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

### User Story 4 - Auto-Memory (Priority: P1)

As a user, I want the agent to automatically remember important information across sessions without me having to manually save it.

**Why this priority**: Significantly reduces friction and allows the agent to build a long-term understanding of the project and workflow.

**Independent Test**: Perform a task that involves a specific build command or architectural decision. Start a new session and verify the agent knows about it by checking the system prompt or asking a related question.

**Acceptance Scenarios**:

1. **Given** auto-memory is enabled, **When** the agent identifies valuable information (build commands, debugging insights, etc.), **Then** it MUST be able to save it to the project's auto-memory directory.
2. **Given** information is saved in `MEMORY.md`, **When** a new session starts, **Then** the first 200 lines of `MEMORY.md` MUST be included in the system prompt.
3. **Given** the agent is in a git repository, **Then** all worktrees of that repository MUST share the same auto-memory directory.
4. **Given** the agent needs to write to its auto-memory, **Then** it MUST be able to do so without manual approval (Safe Zone).

---

### Edge Cases

- **Missing storage files**: The system should create `AGENTS.md`, the global memory file, or the auto-memory directory if they don't exist.
- **Duplicate entries**: The system should ideally prevent or warn about duplicate memory entries.
- **Large memory files**: If memory files grow too large, the system should handle them efficiently. For `MEMORY.md`, only the first 200 lines are loaded.
- **Concurrent access**: Handle cases where multiple agent instances might try to write to the same memory file.
- **Git Worktrees**: Ensure the project ID is stable across different worktrees of the same repository.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow the agent to save memory when requested by the user.
- **FR-002**: System SHOULD provide a way for the agent to distinguish between "Project" and "User" memory.
- **FR-003**: Project memory MUST be stored in `AGENTS.md` in the current working directory.
- **FR-004**: User memory MUST be stored in a global file (e.g., `~/.wave/AGENTS.md`).
- **FR-005**: Memory entries MUST be stored in Markdown bullet point format.
- **FR-006**: System MUST combine project, user, and auto-memory and include it in the AI's system prompt for every request.
- **FR-007**: System SHOULD provide a way to deduplicate memory entries.
- **FR-008**: System SHOULD provide a UI for viewing and deleting memory entries.
- **FR-009**: System MUST support auto-memory stored in `~/.wave/projects/<project-id>/memory/`.
- **FR-010**: System MUST load the first 200 lines of `MEMORY.md` into the system prompt.
- **FR-011**: System MUST allow the agent to write to the auto-memory directory without manual approval.
- **FR-012**: System MUST use the git common directory to identify the project for auto-memory storage.
- **FR-013**: System MUST allow disabling auto-memory via `settings.json` or `WAVE_DISABLE_AUTO_MEMORY=1`.

### Key Entities *(include if feature involves data)*

- **MemoryEntry**: A single piece of persisted information.
    - `content`: The text of the memory.
    - `type`: "Project" or "User".
    - `source`: The file path where it's stored.

## Assumptions

- The user has write permissions to the current directory and the global `~/.wave/` directory.
- The AI model has a sufficient context window to include the combined memory.
- Markdown is the preferred format for human-readability and easy editing.
