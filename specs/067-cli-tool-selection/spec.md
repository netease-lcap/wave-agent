# Feature Specification: CLI Tool Selection

**Feature Branch**: `067-cli-tool-selection`  
**Created**: 2026-02-25  
**Input**: User description: "cli support --tools, Use \"\" to disable all, \"default\" for all, or tool names like \"Bash,Edit,Read\".  agent sdk support tools arg, string[] or undefined"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select Specific Tools (Priority: P1)

As a user, I want to limit the tools available to the agent to a specific set (e.g., only "Read" and "Edit") so that I can control what actions the agent can perform in a given session.

**Why this priority**: This is the core functionality requested. It allows users to restrict the agent's capabilities for security or focus.

**Independent Test**: Can be tested by running the CLI with `--tools "Read,Edit"` and verifying that the agent only attempts to use those tools.

**Acceptance Scenarios**:

1. **Given** the CLI is started with `--tools "Read,Edit"`, **When** the agent is asked to perform a task, **Then** it should only have access to the "Read" and "Edit" tools.
2. **Given** the CLI is started with `--tools "Bash"`, **When** the agent is asked to read a file, **Then** it should fail or report that the tool is unavailable.

---

### User Story 2 - Disable All Tools (Priority: P2)

As a user, I want to disable all tools by providing an empty string to the `--tools` argument, ensuring the agent can only communicate via text.

**Why this priority**: Provides a "safe mode" or "chat-only" mode which is a common requirement for restricted environments.

**Independent Test**: Run CLI with `--tools ""` and verify no tools are registered or available to the agent.

**Acceptance Scenarios**:

1. **Given** the CLI is started with `--tools ""`, **When** the agent is initialized, **Then** the tool list provided to the underlying SDK should be empty.

---

### User Story 3 - Use Default Tools (Priority: P3)

As a user, I want to explicitly request the default set of tools using the "default" keyword, or by omitting the flag entirely.

**Why this priority**: Ensures backward compatibility and provides an explicit way to reset to standard behavior.

**Independent Test**: Run CLI with `--tools "default"` and verify it behaves identically to running without the flag.

**Acceptance Scenarios**:

1. **Given** the CLI is started with `--tools "default"`, **When** the agent is initialized, **Then** it should have access to the full standard suite of tools (Bash, Edit, Read, Glob, Grep, etc.).

---

### User Story 4 - Print Mode Tool Selection (Priority: P2)

As a user, I want to use the `--tools` flag with the `--print` (or `-p`) option so that I can control which tools are available when generating output in print mode.

**Why this priority**: Ensures consistency across all CLI modes that utilize the agent.

**Independent Test**: Run `wave --print --tools "Read" "some prompt"` and verify the agent only uses the "Read" tool.

**Acceptance Scenarios**:

1. **Given** the CLI is run with `--print --tools "Read"`, **When** the agent processes the prompt, **Then** it should only have access to the "Read" tool.

---

### Edge Cases

- **Invalid Tool Names**: What happens when a user provides a tool name that doesn't exist (e.g., `--tools "MagicWand"`)?
  - *Assumption*: The system should probably warn the user and either ignore the invalid tool or fail fast.
- **Case Sensitivity**: Are tool names case-sensitive (e.g., "bash" vs "Bash")?
  - *Assumption*: Tool names should be treated case-insensitively for user convenience, but mapped to the correct internal names.
- **Redundant Input**: What happens with `--tools "Read,Read,Edit"`?
  - *Assumption*: Duplicates should be deduplicated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST support a `--tools` command-line argument.
- **FR-002**: If `--tools` is set to an empty string (`""`), the agent MUST be initialized with no tools.
- **FR-003**: If `--tools` is set to `"default"`, the agent MUST be initialized with the standard set of tools.
- **FR-004**: If `--tools` is a comma-separated list of names (e.g., `"Bash,Edit"`), the agent MUST only have access to those specific tools.
- **FR-005**: The Agent SDK MUST be updated to accept a `tools` argument, which can be a `string[]` or `undefined`.
- **FR-006**: The CLI MUST parse the `--tools` string into a `string[]` before passing it to the Agent SDK.
- **FR-007**: If the `--tools` argument is omitted, the system MUST default to the "default" tool set.
- **FR-008**: If no tools are available (e.g., `--tools ""`), the system prompt MUST NOT include the "Tool usage policy" section.

### Key Entities *(include if feature involves data)*

- **Tool Configuration**: Represents the set of capabilities enabled for a specific agent session.
  - Attributes: `enabledTools` (List of tool identifiers).
