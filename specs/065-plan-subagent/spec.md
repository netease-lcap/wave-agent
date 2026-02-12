# Feature Specification: Plan Subagent Support

**Feature Branch**: `065-plan-subagent`
**Created**: 2026-02-12
**Status**: Implemented
**Input**: User description: "Implement builtin Plan subagent for designing implementation plans"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plan Mode with Built-in Plan Subagent (Priority: P1)

When users enter plan mode, they can spawn built-in Plan subagents to explore the codebase and design implementation approaches. The Plan subagent acts as a software architect, providing detailed implementation plans based on thorough code exploration.

**Why this priority**: Core functionality that enables the plan mode workflow by providing specialized agents that can design implementation strategies without making any code changes.

**Independent Test**: Can be fully tested by entering plan mode, spawning a Plan subagent with requirements, and verifying the subagent explores the codebase and returns a detailed implementation plan without modifying any files.

**Acceptance Scenarios**:

1. **Given** user is in plan mode, **When** user spawns a Plan subagent with implementation requirements, **Then** the subagent explores relevant code and returns a detailed plan with critical files identified
2. **Given** a Plan subagent is exploring the codebase, **When** subagent attempts to edit or create files, **Then** the operation is blocked and an error is returned
3. **Given** multiple Plan subagents with different perspectives are spawned, **When** they complete their work, **Then** each returns a plan based on their assigned perspective (e.g., simplicity vs performance)

---

### User Story 2 - Read-Only Tool Restrictions (Priority: P1)

Plan subagents are strictly limited to read-only operations, ensuring they can explore and analyze code but cannot make any modifications during the planning phase.

**Why this priority**: Critical for maintaining the integrity of plan mode by preventing accidental code changes during the design phase.

**Independent Test**: Can be tested by attempting various file modification operations (Write, Edit, Bash commands with side effects) and verifying all are blocked.

**Acceptance Scenarios**:

1. **Given** a Plan subagent is running, **When** subagent attempts to use Write tool, **Then** tool is not available and operation fails
2. **Given** a Plan subagent is running, **When** subagent attempts to use Edit tool, **Then** tool is not available and operation fails
3. **Given** a Plan subagent is running, **When** subagent attempts bash commands like mkdir, touch, or rm, **Then** system provides clear guidance that only read-only bash operations are allowed

---

### User Story 3 - Multiple Planning Perspectives (Priority: P2)

Users can spawn multiple Plan subagents with different perspectives to explore various implementation approaches for complex tasks.

**Why this priority**: Enables thorough analysis of complex problems by considering multiple architectural approaches and trade-offs.

**Independent Test**: Can be tested by spawning multiple Plan subagents with different perspective prompts and verifying each produces a distinct plan based on their assigned focus.

**Acceptance Scenarios**:

1. **Given** a complex refactoring task, **When** user spawns Plan subagents with "simplicity" and "performance" perspectives, **Then** each subagent produces a plan aligned with their assigned perspective
2. **Given** multiple Plan subagents are running, **When** they explore the same codebase, **Then** their explorations don't interfere with each other

---

### User Story 4 - Critical Files Identification (Priority: P2)

Plan subagents identify and list the 3-5 most critical files for implementing their proposed plan, helping users understand where changes will be made.

**Why this priority**: Provides clear guidance for implementation phase and helps users evaluate the scope and impact of proposed changes.

**Independent Test**: Can be tested by verifying Plan subagent output includes a "Critical Files for Implementation" section with file paths and brief explanations.

**Acceptance Scenarios**:

1. **Given** a Plan subagent completes exploration, **When** it produces its plan, **Then** output includes 3-5 critical files with paths and reasons
2. **Given** critical files are identified, **When** user reviews the plan, **Then** file paths are accurate and reasons explain their importance

---

### Edge Cases

- What happens when Plan subagent encounters files it cannot read due to permissions?
- How does Plan subagent handle very large codebases where exploration could be time-consuming?
- What occurs when Plan subagent references files that have been moved or deleted during planning?
- How does system handle multiple Plan subagents trying to explore the same files concurrently?
- What happens when Plan subagent system prompt is too large and exceeds token limits?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a built-in "Plan" subagent that is available without user configuration
- **FR-002**: Plan subagent MUST be restricted to read-only tools (Glob, Grep, Read, and read-only Bash commands)
- **FR-003**: Plan subagent MUST NOT have access to file modification tools (Write, Edit, NotebookEdit)
- **FR-004**: Plan subagent MUST include a system prompt that clearly states read-only restrictions and planning responsibilities
- **FR-005**: System MUST allow spawning multiple Plan subagents with different perspectives in parallel
- **FR-006**: Plan subagent MUST produce output that includes a "Critical Files for Implementation" section
- **FR-007**: Plan subagent MUST integrate with plan mode workflow as described in plan.tmp.js
- **FR-008**: System MUST provide clear error messages when Plan subagent attempts prohibited operations
- **FR-009**: Plan subagent MUST support exploration of codebase using Glob, Grep, and Read tools without restrictions
- **FR-010**: Plan subagent MUST be able to execute read-only Bash commands (ls, git status, git log, git diff, find, cat, head, tail)
- **FR-011**: System MUST include critical reminder in Plan subagent prompt emphasizing read-only mode
- **FR-012**: Plan subagent MUST use "inherit" model by default to match parent agent's model
- **FR-013**: System MUST list Plan subagent in Task tool descriptions with appropriate "whenToUse" guidance
- **FR-014**: Plan subagent MUST be overridable by user-configured subagents with the same name
- **FR-015**: System MUST validate that Plan subagent only receives read-only tool access at runtime

## Success Criteria

The Plan subagent feature is considered successfully implemented when:

1. ✓ Plan subagent appears in available subagent listings
2. ✓ Users can spawn Plan subagent from plan mode or via Task tool
3. ✓ Plan subagent can explore codebase using read-only tools
4. ✓ All file modification attempts are blocked with clear errors
5. ✓ Plan subagent produces plans with critical files section
6. ✓ Multiple Plan subagents can run in parallel without conflicts
7. ✓ Unit and integration tests pass with adequate coverage
8. ✓ Documentation clearly explains Plan subagent capabilities and restrictions
