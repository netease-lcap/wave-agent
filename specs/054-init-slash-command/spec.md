# Feature Specification: Init Slash Command

**Feature Branch**: `054-init-slash-command`  
**Created**: 2026-01-27  
**Status**: Draft  
**Input**: User description: "support /init slash command, use init-prompt.md as prompt"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Initialize Repository for Agents (Priority: P1)

As a developer setting up a new repository for use with Wave Agent, I want to run a simple command that automatically analyzes the codebase and generates a guidance file for future agent instances.

**Why this priority**: This is the core functionality requested. It enables the "onboarding" of a repository for AI agents, which is a critical first step for productivity.

**Independent Test**: Can be tested by running `/init` in a repository without an `AGENTS.md` file and verifying that a new `AGENTS.md` file is created with the correct prefix and relevant content based on the codebase analysis.

**Acceptance Scenarios**:

1. **Given** a repository without `AGENTS.md`, **When** the user types `/init`, **Then** the agent should analyze the codebase (build commands, architecture, existing rules) and create `AGENTS.md` with the required prefix.
2. **Given** a repository with an existing `AGENTS.md`, **When** the user types `/init`, **Then** the agent should analyze the codebase and suggest improvements or updates to the existing `AGENTS.md` instead of overwriting it blindly.
3. **Given** a repository with `.cursorrules` or `.github/copilot-instructions.md`, **When** the user types `/init`, **Then** the agent should incorporate the important parts of these rules into the generated `AGENTS.md`.

---

### User Story 2 - Discoverability of the Init Command (Priority: P2)

As a user of the Wave Agent CLI, I want to see `/init` as an available command so that I know it exists and how to use it.

**Why this priority**: Discoverability is key for new features. If users don't know the command exists, they won't use it.

**Independent Test**: Can be tested by typing `/` or a help command in the CLI and verifying that `/init` is listed with a brief description.

**Acceptance Scenarios**:

1. **Given** the CLI is active, **When** the user triggers command completion or help, **Then** `/init` should be displayed as a valid option.

---

## Edge Cases

- **What happens when the codebase is empty or has no recognizable structure?** The agent should provide a minimal `AGENTS.md` with the required prefix and a note that no specific architecture was detected, rather than failing or hallucinating.
- **How does the system handle a read-only filesystem?** The agent should inform the user that it cannot create or modify `AGENTS.md` due to permission issues.
- **What if `init-prompt.md` is missing from the expected location?** The command should use a hardcoded version of the prompt as it is a built-in command.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a `/init` slash command in the agent interface.
- **FR-002**: The system MUST use the content of `init-prompt.md` (hardcoded as a built-in prompt) as the base instructions for the agent when `/init` is invoked.
- **FR-003**: The system MUST analyze the current repository to identify build/test/lint commands and high-level architecture.
- **FR-004**: The system MUST create or update a file named `AGENTS.md` in the repository root.
- **FR-005**: The system MUST ensure `AGENTS.md` starts with the mandatory prefix specified in `init-prompt.md`.
- **FR-006**: The system MUST NOT include generic development practices or redundant instructions as specified in the prompt guidelines.
- **FR-007**: The system MUST incorporate existing rules from `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` if they exist.

### Key Entities

- **AGENTS.md**: The output file containing guidance for future agent instances.
- **init-prompt.md**: The template/instruction file that defines how the `/init` command should behave.
- **Repository Context**: The set of files (README, config files, rule files) analyzed to generate the guidance.

## Assumptions

- The `init-prompt.md` file is located at a stable path relative to the agent's execution environment or is bundled with the agent.
- The agent has sufficient permissions to read the entire repository and write to the root directory.
- The user intends for `AGENTS.md` to be a shared resource for any AI agent working on the repo, not just Wave Agent.
