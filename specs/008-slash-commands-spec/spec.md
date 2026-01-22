# Feature Specification: Custom Slash Commands

**Feature Branch**: `008-slash-commands-spec`  
**Created**: December 19, 2024  
**Status**: Implemented  
**Input**: User description: "custom slash commands are already implemented without specs, can you generate spec based on current implement?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Use Basic Custom Commands (Priority: P1)

Users can create custom slash commands by placing markdown files in designated directories to automate frequently used tasks and workflows.

**Why this priority**: This is the core functionality that delivers immediate productivity value by allowing users to encapsulate complex instructions into simple commands.

**Independent Test**: Can be fully tested by creating a simple command file (e.g., `/project-info`) and executing it to verify the command runs and produces expected output.

**Acceptance Scenarios**:

1. **Given** a user has a `.wave/commands/` directory in their project, **When** they create a markdown file named `project-info.md` with command content, **Then** the system automatically loads it as a `/project-info` command
2. **Given** a custom command exists, **When** user types `/project-info` in the chat, **Then** the command executes and displays the result in the conversation
3. **Given** a custom command file is modified, **When** the system reloads commands, **Then** the updated command behavior is available immediately

---

### User Story 2 - Command Discovery and Autocomplete (Priority: P1)

Users can discover available custom commands through an interactive command selector with autocomplete functionality.

**Why this priority**: Essential for usability - users need to know what commands are available and be able to find them easily.

**Independent Test**: Can be tested by typing `/` and verifying the command selector appears with both built-in and custom commands, with functional search filtering.

**Acceptance Scenarios**:

1. **Given** custom commands are loaded, **When** user types `/` in the input box, **Then** a command selector appears showing both built-in and custom commands
2. **Given** the command selector is open, **When** user types characters after `/`, **Then** the list filters to show only matching commands
3. **Given** the command selector shows filtered results, **When** user navigates with arrow keys and presses Enter, **Then** the selected command is executed

---

### User Story 3 - Parameterized Commands (Priority: P2)

Users can create commands that accept arguments and use parameter substitution to create flexible, reusable command templates.

**Why this priority**: Significantly increases command utility by allowing dynamic content and reducing the need for multiple similar commands.

**Independent Test**: Can be tested by creating a command with `$ARGUMENTS` or `$1, $2` placeholders and verifying they are correctly substituted when the command is called with arguments.

**Acceptance Scenarios**:

1. **Given** a command contains `$ARGUMENTS` in its content, **When** user executes `/command-name some arguments`, **Then** `$ARGUMENTS` is replaced with "some arguments"
2. **Given** a command contains `$1 $2` placeholders, **When** user executes `/command-name first second`, **Then** `$1` becomes "first" and `$2` becomes "second"
3. **Given** a command expects parameters, **When** user provides quoted arguments with spaces, **Then** the quoted content is treated as a single parameter
4. **Given** a command contains NO parameter placeholders, **When** user executes `/command-name some arguments`, **Then** "some arguments" is automatically appended to the command content

---

### User Story 4 - Command Configuration and Model Selection (Priority: P2)

Users can configure custom commands with specific AI models using YAML frontmatter.

**Why this priority**: Enables optimization of commands for specific use cases.

**Independent Test**: Can be tested by creating a command with frontmatter specifying a model, then verifying the AI uses the specified configuration during execution.

**Acceptance Scenarios**:

1. **Given** a command has `model: gpt-4` in its frontmatter, **When** the command executes, **Then** the AI uses the specified model instead of the default
2. **Given** a command has a custom description in frontmatter, **When** command selector is shown, **Then** the custom description appears instead of auto-generated text

---

### User Story 5 - Project and User-Level Command Scope (Priority: P3)

Users can define commands at both project level (`.wave/commands/`) and user level (`~/.wave/commands/`) with project commands taking precedence.

**Why this priority**: Provides flexibility for both project-specific workflows and personal productivity commands that work across projects.

**Independent Test**: Can be tested by creating commands with the same name in both locations and verifying project-level commands override user-level ones.

**Acceptance Scenarios**:

1. **Given** a user has commands in `~/.wave/commands/`, **When** they use any project, **Then** those commands are available globally
2. **Given** both user and project directories contain a command with the same name, **When** the command is executed, **Then** the project-level version is used
3. **Given** a project has no `.wave/commands/` directory, **When** user-level commands exist, **Then** they are still loaded and available

---

### User Story 6 - Auto-approved Tool Execution (Priority: P1)

As a user, I want the AI to execute specific tools automatically when I trigger a slash command, so that I don't have to manually confirm every step of a known workflow.

**Why this priority**: This is a high-value enhancement that reduces friction for common automated tasks.

**Independent Test**: Can be tested by triggering a slash command with `allowed-tools` and verifying that the AI executes those tools without prompting the user for confirmation.

**Acceptance Scenarios**:

1. **Given** a slash command defined with `allowed-tools: Bash(git commit:*)`, **When** the user triggers this command and the AI calls `Bash(git commit -m "test")`, **Then** the tool should execute immediately without a confirmation prompt because it matches the prefix.
2. **Given** a slash command defined with `allowed-tools: Bash(git commit:*)`, **When** the user triggers this command and the AI calls `Bash(git commit -m "test" && rm -rf /)`, **Then** the tool MUST be blocked or require confirmation because the second part of the command chain is not allowed.
3. **Given** a slash command with `allowed-tools`, **When** the AI calls a tool NOT in the list (e.g., `Write`), **Then** the system MUST prompt the user for confirmation as usual (unless it's already allowed in `settings.json`).
4. **Given** an active slash command session with `allowed-tools`, **When** the AI finishes its task and the response cycle ends, **Then** all subsequent tool executions MUST require manual confirmation.

---

### Edge Cases

- What happens when a command file contains invalid YAML frontmatter?
- How does system handle commands with infinite loops or long-running operations?
- What occurs when a command references non-existent parameters (e.g., `$5` when only 2 arguments provided)?
- How are commands with identical names handled during reload operations?
- What happens when bash commands within custom commands fail or timeout?
- **Empty Allowed Tools**: If a slash command is defined without `allowed-tools`, all tool executions MUST require manual confirmation.
- **Invalid Pattern Syntax**: If an `allowed-tools` pattern is syntactically invalid, the system SHOULD ignore that specific pattern and default to manual confirmation for matching tools.
- **Session Persistence**: If the user starts a new task or switches context, any active `allowed-tools` privileges from a previous slash command MUST be revoked.
- **Overlapping Patterns**: If multiple patterns match a tool execution, the most permissive one (auto-approval) takes precedence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically discover and load custom commands from `.wave/commands/` directories in both project root and user home directory
- **FR-002**: System MUST support markdown files with YAML frontmatter for command configuration including model selection  
- **FR-003**: System MUST provide parameter substitution using `$ARGUMENTS` for all arguments and `$1`, `$2`, etc. for positional arguments
- **FR-004**: System MUST parse quoted arguments correctly, treating quoted strings as single parameters even when containing spaces
- **FR-005**: System MUST execute embedded bash commands within command content and replace them with their output
- **FR-006**: System MUST provide a command selector interface triggered by typing `/` with search filtering capabilities
- **FR-005**: System MUST prioritize project-level commands over user-level commands when names conflict
- **FR-008**: System MUST include built-in commands (like `clear`) alongside custom commands in the interface
- **FR-009**: System MUST reload custom commands when files are modified without requiring application restart
- **FR-010**: System MUST validate slash command syntax and provide appropriate error handling for malformed commands
- **FR-011**: System MUST support command abortion/cancellation for long-running operations
- **FR-012**: System MUST log command execution status and errors for debugging purposes
- **FR-013**: System MUST automatically append user arguments to command content if the command markdown contains no parameter placeholders ($ARGUMENTS or $1, $2, etc.)
- **FR-014**: System MUST parse the `allowed-tools` metadata from the slash command header.
- **FR-015**: System MUST temporarily grant permissions for tools listed in `allowed-tools` for the duration of the command's AI response cycle.
- **FR-016**: System MUST revoke temporary permissions once the AI response cycle completes.
- **FR-017**: System MUST NOT persist `allowed-tools` from a slash command to persistent settings.
- **FR-018**: System MUST recursively scan the `.wave/commands/` directory to discover all markdown files from root level (level 0) and first level nesting (level 1) only.
- **FR-019**: System MUST register each discovered markdown file as an available slash command using simple syntax for root-level commands (e.g., `/help`) and colon-separated syntax for nested commands (e.g., `/openspec:apply`).
- **FR-020**: System MUST support command discovery up to a maximum of 1 level of nesting and ignore any markdown files beyond this depth.
- **FR-021**: System MUST ignore non-markdown files during the discovery process.
- **FR-022**: System MUST integrate discovered nested commands with the existing CommandSelector component without requiring changes to the current navigation UI.

### Key Entities

- **SlashCommand**: Represents any executable command with id, name, description, and handler function
- **CustomSlashCommand**: Extends SlashCommand with file path, markdown content, and configuration metadata
- **CustomSlashCommandConfig**: Configuration options including AI model preference and custom description
- **SlashCommandManager**: Central orchestrator for command registration, discovery, execution, and lifecycle management
- **CommandSelector**: User interface component for command discovery and selection with search functionality
- **Allowed Tool Pattern**: A string representing a permitted tool and its allowed argument patterns (e.g., `Bash(git status:*)`).
- **Privileged Session**: The stateful context that tracks whether auto-approval is currently active and which tools are allowed.
- **Command Path**: The hierarchical path from `.wave/commands/` to the markdown file, converted to colon-separated syntax for command invocation (e.g., `openspec:apply`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a new custom command and use it within 30 seconds of saving the markdown file
- **SC-002**: Command selector displays all available commands (built-in + custom) in under 100ms when triggered
- **SC-003**: Parameter substitution processes commands with up to 10 arguments in under 5ms
- **SC-004**: System successfully loads and validates 50+ custom commands without performance degradation
- **SC-005**: 95% of command executions complete successfully when command syntax is valid
- **SC-006**: Users can find desired commands within 3 keystrokes using the search functionality
- **SC-005**: Command reloading completes within 200ms after file system changes are detected
- **SC-008**: Zero data loss occurs during command execution, with all conversation context preserved

---

### User Story 7 - Nested Command Discovery (Priority: P2)

Users can organize their custom slash commands in nested directory structures within the `.wave/commands/` directory, and the system automatically discovers and makes available all markdown files at any depth level up to 1 level deep.

**Why this priority**: This ensures comprehensive command discovery across all organizational structures users might employ, from simple flat commands to categorized nested commands.

**Independent Test**: Can be tested by creating commands at different directory levels and verifying that all are discovered and accessible through their appropriate syntax.

**Acceptance Scenarios**:

1. **Given** a `.wave/commands/` directory with nested subdirectories containing markdown files, **When** the system scans for available commands, **Then** all markdown files from root and first level nesting are discovered
2. **Given** a nested command structure like `.wave/commands/openspec/apply.md`, **When** a user types `/openspec:apply`, **Then** the system executes the command defined in the apply.md file
3. **Given** commands exist at root level (`.wave/commands/help.md`), **When** the system scans for commands, **Then** these commands are discovered and accessible as `/help`
