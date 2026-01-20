# Feature Specification: Custom Slash Commands

**Feature Branch**: `005-slash-commands-spec`  
**Created**: December 19, 2024  
**Status**: Draft  
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

### Edge Cases

- What happens when a command file contains invalid YAML frontmatter?
- How does system handle commands with infinite loops or long-running operations?
- What occurs when a command references non-existent parameters (e.g., `$5` when only 2 arguments provided)?
- How are commands with identical names handled during reload operations?
- What happens when bash commands within custom commands fail or timeout?

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

### Key Entities

- **SlashCommand**: Represents any executable command with id, name, description, and handler function
- **CustomSlashCommand**: Extends SlashCommand with file path, markdown content, and configuration metadata
- **CustomSlashCommandConfig**: Configuration options including AI model preference and custom description
- **SlashCommandManager**: Central orchestrator for command registration, discovery, execution, and lifecycle management
- **CommandSelector**: User interface component for command discovery and selection with search functionality

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