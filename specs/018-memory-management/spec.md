# Feature Specification: Memory Management

**Feature Branch**: `018-memory-management`  
**Created**: 2026-01-22  
**Input**: User description: "Memory Management for persisting information across conversations"

## Clarifications

### Session 2026-01-27
- Q: If a task involves multiple files, how should path-specific memory rules be activated? → A: Union: Activate all memory rules that match any of the files currently being read or modified in the task.
- Q: Which tool interactions or context signals should trigger the activation of a path-specific memory rule? → A: Any in Context: Any file currently loaded in the context window (via Read, Grep, etc.) or being written.

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

### User Story 5 - Modular Memory Rules (Priority: P1)

As a developer, I want to organize project instructions into multiple files within a `.wave/rules/` directory so that I can maintain focused memory rule files instead of one large `AGENTS.md`.

**Why this priority**: This is the primary goal of the feature—enabling modular organization of memory rules.

**Independent Test**: Create multiple `.md` files in `.wave/rules/` and verify they are automatically loaded as project memory with the same priority as `AGENTS.md`.

**Acceptance Scenarios**:

1. **Given** a project with `.wave/rules/code-style.md` and `.wave/rules/testing.md`, **When** Wave starts, **Then** both files should be loaded as project memory.
2. **Given memory rules** in `.wave/rules/`, **When** Wave performs a task, **Then** it should adhere to the instructions in those files.

---

### User Story 6 - Path-Specific Memory Rules (Priority: P1)

As a developer, I want to scope memory rules to specific files using YAML frontmatter so that memory rules only apply when Wave is working with files matching specified patterns.

**Why this priority**: Essential for large projects where different directories (e.g., frontend vs. backend) have different requirements.

**Independent Test**: Create a memory rule with a `paths` field and verify it is only active when the agent is working on a matching file.

**Acceptance Scenarios**:

1. **Given a memory rule** with `paths` containing `"src/api/**/*.ts"`, **When** Wave edits `src/api/user.ts`, **Then** the memory rule should be active.
2. **Given** the same memory rule, **When** Wave edits `src/ui/Button.tsx`, **Then** the memory rule should NOT be active.
3. **Given a memory rule** without a `paths` field, **When** Wave edits any file, **Then** the memory rule should always be active.

---

### User Story 7 - Memory Rule Organization in Subdirectories (Priority: P2)

As a team lead, I want to organize memory rules into subdirectories within `.wave/rules/` and use symlinks to share memory rules across projects.

**Why this priority**: Improves maintainability for complex setups and enables cross-project standard enforcement.

**Independent Test**: Create subdirectories in `.wave/rules/` and symlinks to external memory rule files, then verify they are discovered and loaded.

**Acceptance Scenarios**:

1. **Given memory rules** in `.wave/rules/frontend/react.md`, **When** Wave loads memory rules, **Then** it should discover and load `react.md` from the subdirectory.
2. **Given** a symlink `.wave/rules/shared` pointing to an external directory, **When** Wave loads memory rules, **Then** it should resolve the symlink and load the memory rules within.

---

### User Story 8 - User-Level Modular Memory Rules (Priority: P2)

As a user, I want to define personal memory rules in `~/.wave/rules/` that apply across all my projects.

**Why this priority**: Allows users to maintain personal preferences (e.g., workflow, style) globally.

**Independent Test**: Create a memory rule in `~/.wave/rules/preferences.md` and verify it is loaded in any project.

**Acceptance Scenarios**:

1. **Given a memory rule** in `~/.wave/rules/`, **When** Wave starts in any project, **Then** the user-level memory rule should be loaded.
2. **Given** a conflict between a user-level memory rule and a project-level memory rule, **Then** the project-level memory rule should take priority.

---

### Edge Cases

- **Missing storage files**: The system should create `AGENTS.md`, the global memory file, or the auto-memory directory if they don't exist.
- **Duplicate entries**: The system should ideally prevent or warn about duplicate memory entries.
- **Large memory files**: If memory files grow too large, the system should handle them efficiently. For `MEMORY.md`, only the first 200 lines are loaded.
- **Concurrent access**: Handle cases where multiple agent instances might try to write to the same memory file.
- **Git Worktrees**: Ensure the project ID is stable across different worktrees of the same repository.
- **Circular Symlinks**: How does the system handle symlinks that point back to themselves or create a loop? (Requirement: Detect and handle gracefully).
- **Invalid YAML**: How does the system handle a memory rule file with malformed frontmatter?
- **Brace Expansion**: Ensuring patterns like `{src,lib}/**/*.ts` are correctly expanded.
- **Empty Rules Directory**: System should not error if `.wave/rules/` is missing or empty.

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
- **FR-014**: System MUST discover all `.md` files in `.wave/rules/` and its immediate subdirectories and load them as project memory.
- **FR-015**: System MUST support YAML frontmatter in memory rule files with a `paths` field containing a list of glob patterns.
- **FR-016**: System MUST apply path-specific memory rules using an event-driven trigger system. Rules are activated if *any* file currently in the "active" context (read, modified, or explicitly mentioned) matches the glob patterns.
- **FR-017**: If multiple files are in context, the system MUST activate the union of all matching memory rules.
- **FR-025**: System MUST maintain a session-persistent set of loaded memory rules to ensure each rule is attached only once per session (deduplication).
- **FR-026**: System MUST clear the deduplication set during conversation compaction to allow relevant rules to be re-injected into the new context.
- **FR-018**: System MUST support standard glob patterns, including `**` for recursive matching and brace expansion (e.g., `*.{ts,tsx}`).
- **FR-019**: System MUST resolve symlinks within the `.wave/rules/` directory and load the target contents.
- **FR-020**: System MUST detect and gracefully handle circular symlinks to prevent infinite loops.
- **FR-021**: System MUST load user-level memory rules from `~/.wave/rules/`.
- **FR-022**: System MUST prioritize project-level memory rules over user-level memory rules when they are loaded.
- **FR-023**: Memory rules without a `paths` field MUST be loaded unconditionally.
- **FR-024**: Modular memory rules MUST have the same priority as `AGENTS.md` within the project context.

### Key Entities *(include if feature involves data)*

- **MemoryEntry**: A single piece of persisted information.
    - `content`: The text of the memory.
    - `type`: "Project" or "User".
    - `source`: The file path where it's stored.
- **Memory Rule File**: A Markdown file containing instructions, optionally with YAML frontmatter for scoping.
- **Glob Pattern**: A string used to match file paths (e.g., `src/**/*.ts`).
- **Memory Rule Registry**: The internal system that manages discovered memory rules and determines which are active based on context.

## Assumptions

- The user has write permissions to the current directory and the global `~/.wave/` directory.
- The AI model has a sufficient context window to include the combined memory.
- Markdown is the preferred format for human-readability and easy editing.
