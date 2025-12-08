# Feature Specification: Built-in Subagent Support

**Feature Branch**: `025-builtin-subagent`  
**Created**: 2025-12-08  
**Status**: Draft  
**Input**: User description: "Add build-in subagent, refer to explore-agent.js"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Subagent Access (Priority: P1)

Users can access pre-configured built-in subagents without needing to create or configure their own subagent files. They can delegate tasks to specialized agents immediately after installing the system.

**Why this priority**: Core functionality that provides immediate value and demonstrates the subagent system's capability without requiring configuration effort from users.

**Independent Test**: Can be fully tested by calling the Task tool with a built-in subagent name and verifies the subagent executes successfully, delivering specialized task completion.

**Acceptance Scenarios**:

1. **Given** a fresh installation with no user-configured subagents, **When** user invokes Task tool with "Explore" subagent type, **Then** the built-in explore agent executes successfully and returns search results
2. **Given** built-in subagents are available, **When** user calls Task tool without valid subagent_type, **Then** system lists available subagents including both built-in and user-configured ones

---

---

### User Story 2 - Consistent Subagent Interface (Priority: P2)

Built-in subagents work identically to user-configured subagents, providing a consistent experience across all subagent types.

**Why this priority**: Ensures architectural consistency and prevents user confusion between built-in and custom subagents.

**Independent Test**: Can be tested by verifying built-in subagents produce identical message structures, tool restrictions, and execution behavior as user-configured subagents.

**Acceptance Scenarios**:

1. **Given** a built-in subagent and a user subagent, **When** both execute similar tasks, **Then** their output format, status reporting, and lifecycle management are identical
2. **Given** built-in subagents are executed, **When** tasks complete, **Then** they create the same SubagentBlock structure as user-configured subagents

---

### Edge Cases

- What happens when built-in subagent names conflict with user-configured subagent names?
- How does system handle loading built-in subagents when source files are missing or corrupted?
- What occurs when built-in subagents reference tools that don't exist?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST load built-in subagent configurations from internal source code rather than external files
- **FR-002**: System MUST make built-in subagents available immediately without requiring user configuration
- **FR-003**: Built-in subagents MUST integrate seamlessly with the existing SubagentManager and Task tool
- **FR-004**: System MUST include an "Explore" built-in subagent for codebase exploration tasks
- **FR-005**: Built-in subagents MUST support the same configuration options as file-based subagents (tools, model, systemPrompt)
- **FR-006**: System MUST handle priority ordering between built-in, user, and project subagents
- **FR-007**: Built-in subagents MUST appear in Task tool descriptions and in error messages when invalid subagent types are provided
- **FR-008**: System MUST allow built-in subagent names to be overridden by user configurations with higher priority
- **FR-009**: Built-in subagents MUST support tool filtering and model specification like standard subagents
- **FR-010**: System MUST gracefully handle missing or invalid built-in subagent definitions

### Key Entities *(include if feature involves data)*

- **BuiltinSubagentDefinition**: Represents a hardcoded subagent configuration with name, description, systemPrompt, allowed tools, and model preferences
- **SubagentSource**: Enum identifying whether a subagent comes from built-in definitions, user files, or project files
- **SubagentPriority**: Ordering system that ensures built-in subagents have appropriate precedence (typically lower than project/user configs)