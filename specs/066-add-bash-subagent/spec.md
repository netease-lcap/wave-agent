# Feature Specification: Add Bash Builtin Subagent

**Feature Branch**: `066-add-bash-subagent`  
**Created**: 2026-02-12  
**Status**: Draft  
**Input**: User description: "add bash builtin subagent, refer to /home/liuyiqi/.nvm/versions/node/v22.20.0/lib/node_modules/bash-agent.tmp.js"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execute Bash Commands via Subagent (Priority: P1)

As a user, I want to delegate complex bash operations (like git workflows or multi-step terminal tasks) to a specialized subagent so that the main agent can focus on high-level reasoning while the subagent handles the execution details.

**Why this priority**: This is the core functionality. It enables the main agent to offload terminal-heavy tasks to a specialized persona, improving efficiency and reliability.

**Independent Test**: Can be tested by asking the main agent to perform a complex git operation (e.g., "rebase this branch and fix conflicts") and verifying that it invokes the "Bash" subagent to handle the commands.

**Acceptance Scenarios**:

1. **Given** the main agent needs to run multiple bash commands, **When** it identifies the task as terminal-heavy, **Then** it should be able to call the "Bash" subagent.
2. **Given** the Bash subagent is invoked, **When** it receives a task, **Then** it should use its specialized system prompt to execute commands safely and report results.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST include a new built-in subagent named "Bash".
- **FR-002**: The Bash subagent MUST be described as a "Command execution specialist for running bash commands".
- **FR-003**: The Bash subagent MUST be recommended for git operations, command execution, and other terminal tasks.
- **FR-004**: The Bash subagent MUST use a specific system prompt that emphasizes precision, safety, clear reporting, and proper path quoting.
- **FR-005**: The Bash subagent MUST inherit the model configuration from the main agent.
- **FR-006**: The Bash subagent MUST have access to the standard bash execution tools (equivalent to `S4` in the reference).
- **FR-007**: The Bash subagent MUST be registered as a "built-in" source.

### Key Entities *(include if feature involves data)*

- **Subagent Configuration**: Represents the metadata and behavior of the subagent (name, type, prompt, tools).
- **System Prompt**: The specialized instructions that define the Bash subagent's persona and constraints.
