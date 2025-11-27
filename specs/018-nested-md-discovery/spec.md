# Feature Specification: Nested Markdown Discovery for Slash Commands

**Feature Branch**: `018-nested-md-discovery`  
**Created**: 2025-11-27  
**Status**: Draft  
**Input**: User description: "slash-commands should support nested md discovery. for example ./.wave
./.wave/commands
./.wave/commands/openspec
./.wave/commands/openspec/apply.md
./.wave/commands/openspec/proposal.md
./.wave/commands/openspec/archive.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Nested Command Discovery (Priority: P1)

Users can organize their custom slash commands in nested directory structures within the `.wave/commands/` directory, and the system automatically discovers and makes available all markdown files at any depth level.

**Why this priority**: This is the core functionality that enables organized command hierarchies. Without this, users are limited to flat command structures, which becomes unwieldy as the number of commands grows.

**Independent Test**: Can be fully tested by creating a nested directory structure with markdown files and verifying that all commands are discovered and accessible through the slash command interface.

**Acceptance Scenarios**:

1. **Given** a `.wave/commands/` directory with nested subdirectories containing markdown files, **When** the system scans for available commands, **Then** all markdown files from all nested levels are discovered and registered as available slash commands
2. **Given** a nested command structure like `.wave/commands/openspec/apply.md`, **When** a user types `/openspec:apply`, **Then** the system executes the command defined in the apply.md file
3. **Given** multiple markdown files in the same nested directory, **When** the system discovers commands, **Then** each markdown file is registered as a separate command with its parent directory path as prefix

---

### User Story 2 - Multi-Level Command Discovery (Priority: P2)

The system discovers and makes available commands from root level (`.wave/commands/command.md`) and first level nesting (`.wave/commands/category/command.md`) only.

**Why this priority**: This ensures comprehensive command discovery across all organizational structures users might employ, from simple flat commands to categorized nested commands.

**Independent Test**: Can be tested by creating commands at different directory levels and verifying that all are discovered and accessible through their appropriate syntax.

**Acceptance Scenarios**:

1. **Given** commands exist at root level (`.wave/commands/help.md`), **When** the system scans for commands, **Then** these commands are discovered and accessible as `/help`
2. **Given** commands exist at first level (`.wave/commands/git/status.md`), **When** the system scans for commands, **Then** these commands are discovered and accessible as `/git:status`
3. **Given** commands exist at both root and first level, **When** user lists available commands, **Then** all commands from both levels are shown with their appropriate syntax

---

### Edge Cases

- What happens when there are naming conflicts between nested and flat commands (resolved by using colon syntax for nested commands)?
- How does the system handle the maximum nesting depth of 1 level?
- What happens when users try to create commands deeper than 1 level of nesting?
- What happens when directory names contain special characters or spaces?
- How are empty directories or directories without markdown files handled?
- What happens when markdown files have invalid names or extensions?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST recursively scan the `.wave/commands/` directory to discover all markdown files from root level (level 0) and first level nesting (level 1) only
- **FR-002**: System MUST register each discovered markdown file as an available slash command using simple syntax for root-level commands (e.g., `/help` for `.wave/commands/help.md`) and colon-separated syntax for nested commands (e.g., `/openspec:apply` for `.wave/commands/openspec/apply.md`)
- **FR-003**: Users MUST be able to invoke root-level commands using simple syntax (e.g., `/help`) and nested commands using hierarchical colon syntax (e.g., `/category:command`)
- **FR-004**: System MUST support command discovery from root level (`.wave/commands/command.md`) and first level nesting (`.wave/commands/category/command.md`) only
- **FR-005**: System MUST handle naming conflicts between nested and flat commands by using simple slash syntax for root-level commands (e.g., `/apply`) and colon syntax for nested commands (e.g., `/openspec:apply`)
- **FR-006**: System MUST support command discovery up to a maximum of 1 level of nesting (e.g., `/category:command`) and ignore any markdown files beyond this depth
- **FR-007**: System MUST ignore non-markdown files during the discovery process
- **FR-008**: System MUST integrate discovered nested commands with the existing CommandSelector component without requiring changes to the current navigation UI

### Key Entities *(include if feature involves data)*

- **Command File**: A markdown file containing command definitions, located anywhere within the `.wave/commands/` directory hierarchy
- **Command Path**: The full directory path from `.wave/commands/` to the markdown file, converted to colon-separated syntax for command invocation (e.g., `openspec:apply` for `.wave/commands/openspec/apply.md`)
- **Command Registry**: The internal data structure that maps command paths to their corresponding markdown files and metadata