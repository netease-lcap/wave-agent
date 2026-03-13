# Feature Specification: Tool Permission System

**Feature Branch**: `024-tool-permission-system`  
**Input**: Comprehensive merge of tool permission features including basic modes, wildcard matching, secure pipeline validation, and deny rules.

## Overview

The Tool Permission System provides a robust security layer for the Wave agent, ensuring that potentially destructive or sensitive operations are authorized by the user. It supports multiple permission modes, fine-grained rule matching with wildcards, secure decomposition of shell pipelines, and explicit denial of specific tools or paths.

## User Scenarios & Testing

### User Story 1 - Default Safe Mode with Confirmations (Priority: P1)

A user runs Wave CLI without any special flags, and the system prompts for confirmation before executing any potentially destructive operations like file edits or bash commands.

**Acceptance Scenarios**:
1. **Given** a user runs Wave CLI without flags, **When** Wave attempts to edit a file, **Then** a confirmation prompt appears asking "Do you want to proceed?" with options to allow or modify the request.
2. **Given** a confirmation prompt is shown, **When** user selects "Yes", **Then** the operation proceeds normally.
3. **Given** a confirmation prompt is shown, **When** user types alternative instructions, **Then** Wave receives the new instructions through the tool result field instead of executing the original operation.
4. **Given** the AI returns multiple restricted tool calls, **When** each tool call is executed, **Then** individual sequential confirmation prompts appear for each.

### User Story 2 - Bypass Mode for Advanced Users (Priority: P2)

An advanced user runs Wave CLI with `--dangerously-skip-permissions` to bypass all permission checks for uninterrupted operation.

**Acceptance Scenarios**:
1. **Given** bypass mode is enabled, **When** Wave attempts any restricted operation, **Then** no confirmation prompts appear and operations execute immediately.

### User Story 3 - Wildcard Matching for Commands (Priority: P1)

As a user, I want to allow a group of related commands by specifying a common pattern with wildcards, so that I don't have to list every single variation of a command in my permissions.

**Acceptance Scenarios**:
1. **Given** `permissions.allow` contains `Bash(git commit *)`, **When** the agent attempts to run `Bash(git commit -m "initial commit")`, **Then** the action is allowed.
2. **Given** `permissions.allow` contains `Bash(git * main)`, **When** the agent attempts to run `Bash(git push origin main)`, **Then** the action is allowed.

### User Story 4 - Smart Wildcard Heuristic (Priority: P1)

As a user, I want to trust a command like `npm install lodash` so that I am not prompted again when I run `npm install express`.

**Acceptance Scenarios**:
1. **Given** the system prompts for `npm install lodash`, **When** the user selects "Yes, and don't ask again", **Then** the system should suggest a smart wildcard pattern (e.g., `npm install *`) and save it.
2. **Given** `npm install *` is trusted, **When** the user runs `npm install express`, **Then** it executes immediately without prompting.

### User Story 5 - Decompose and Validate Chained Commands (Priority: P1)

As a user, I want the system to automatically permit complex commands (using `&&`, `|`, etc.) if and only if every individual command within the chain is already permitted.

**Acceptance Scenarios**:
1. **Given** `permissions.allow` contains `cd /tmp/*` and `ls`, **When** the user executes `cd /tmp/test && ls`, **Then** the system SHOULD automatically permit the command.
2. **Given** `permissions.allow` contains `cd /tmp/*` but NOT `rm *`, **When** the user executes `cd /tmp/test && rm -rf /`, **Then** the system MUST NOT automatically permit and SHOULD prompt for permission.

### User Story 6 - Deny Rules & Precedence (Priority: P1)

As a security-conscious user, I want to explicitly forbid the agent from using certain tools or accessing specific paths, even if they would otherwise be allowed.

**Acceptance Scenarios**:
1. **Given** `permissions.deny` contains `["Bash"]`, **When** the agent attempts to run any bash command, **Then** the system MUST block the execution.
2. **Given** `permissions.allow` contains `["*"]` and `permissions.deny` contains `["Bash"]`, **When** the agent attempts to run a bash command, **Then** the system MUST deny the request because the deny rule takes precedence.

### User Story 7 - Path-based Permissions (Priority: P1)

As a user, I want to prevent the agent from accessing specific files (e.g., `.env` files) by defining deny rules for tools that operate on file paths.

**Acceptance Scenarios**:
1. **Given** `permissions.deny` contains `["Read(**/.env)"]`, **When** the agent attempts to read a file named `.env` in any directory, **Then** the system MUST deny the request.

### User Story 8 - Built-in Safe Commands with Path Restrictions (Priority: P3)

As a user, I want common safe commands (like `cd`) to be automatically permitted by default, but only when they operate within the current working directory.

**Acceptance Scenarios**:
1. **Given** the CWD is `/home/user/project`, **When** the user executes `cd src`, **Then** the system SHOULD automatically permit it.
2. **Given** the CWD is `/home/user/project`, **When** the user executes `cd /etc`, **Then** the system MUST NOT automatically permit it.

## Requirements

### Functional Requirements

#### Permission Modes & UI
- **FR-001**: Agent MUST support `permissionMode` values: "default", "bypassPermissions", "acceptEdits", "plan".
- **FR-002**: Wave CLI MUST support `--dangerously-skip-permissions` to set mode to "bypassPermissions".
- **FR-003**: CLI MUST provide a confirmation component for restricted tools in "default" mode.
- **FR-004**: Confirmation component MUST support "Yes", "Yes, and don't ask again", and alternative instructions via text input.
- **FR-005**: System MUST support a `canUseTool` callback in the Agent SDK for custom permission logic.
- **FR-006**: System MUST support cycling through permission modes (default -> acceptEdits -> plan) via `Shift+Tab`.
- **FR-021**: System MUST hide the "Don't ask again" option for commands identified as dangerous or out-of-bounds.
- **FR-022**: System MUST detect write redirections (`>`, `>>`, etc.) in bash commands and treat them as dangerous, hiding the "Don't ask again" option.

#### Matching Logic & Wildcards
- **FR-007**: System MUST support exact string matching and `*` wildcard matching for rules in `permissions.allow` and `permissions.deny`.
- **FR-008**: Wildcards (`*`) MUST be supported at any position in the pattern.
- **FR-009**: System MUST implement a "smart wildcard" heuristic to suggest patterns for bash commands (e.g., `npm install *`).
- **FR-010**: System MUST NOT allow wildcard matching for highly sensitive commands (e.g., `rm`, `sudo`, `chmod`). These always require exact matches or manual approval.
- **FR-023**: System MUST split chained commands into individual simple commands when the user selects "Don't ask again".
- **FR-024**: System MUST NOT save builtin safe commands to the `permissions.allow` array when splitting a chain.

#### Secure Pipeline Validation
- **FR-011**: System MUST parse complex bash commands and identify all individual "simple commands" joined by operators (`&&`, `||`, `;`, `|`).
- **FR-012**: A complex command MUST be automatically permitted ONLY IF every constituent simple command matches a permitted rule.
- **FR-013**: System MUST strip inline environment variable assignments (e.g., `VAR=val cmd`) before matching.
- **FR-025**: System MUST ensure that bash commands with write redirections are not automatically allowed by default rules (e.g., `Bash(echo*)`).

#### Deny Rules & Path-based Permissions
- **FR-014**: System MUST support a `permissions.deny` field in settings.
- **FR-015**: `permissions.deny` MUST take precedence over `permissions.allow`.
- **FR-016**: System MUST support path-based rules in the format `ToolName(path_pattern)` (e.g., `Read(**/*.env)`) for tools that take a single path as primary input.
- **FR-017**: If a request matches any rule in `permissions.deny`, it MUST be denied immediately.

#### Built-in Safe Commands
- **FR-018**: System MUST maintain a built-in list of safe commands (`cd`, `ls`, `pwd`) that are permitted if they operate within the CWD or its subdirectories.
- **FR-019**: Built-in safe commands attempting to access paths outside the CWD (e.g., `cd ..`, `ls /etc`) MUST require explicit permission.
- **FR-020**: System MUST NOT allow the use of `find` and `sed` commands in the `Bash` tool, and MUST return a specific denial message suggesting the use of specialized tools (`Glob`, `Grep`, `Read`, `Edit`).

## Key Entities

- **Permission Mode**: Configuration determining the level of user intervention required.
- **Permission Rule**: A string defining a permitted or denied action (e.g., `Bash(git *)`, `Read(**/*.env)`).
- **Simple Command**: A single executable command with its arguments, extracted from a pipeline.
- **Smart Wildcard**: A heuristic-generated pattern that replaces dynamic arguments with `*`.

## Edge Cases

- **Nested Operators**: Pipelines like `cmd1 && (cmd2 | cmd3)` must be recursively decomposed.
- **Precedence**: Deny rules always win over allow rules.
- **Sensitive Commands**: Commands like `rm` are blacklisted from smart wildcard suggestions to prevent accidental broad permissions.
- **Escaped Characters**: `echo "&&"` must be treated as a single command, not split.
uration determining the level of user intervention required.
- **Permission Rule**: A string defining a permitted or denied action (e.g., `Bash(git *)`, `Read(**/*.env)`).
- **Simple Command**: A single executable command with its arguments, extracted from a pipeline.
- **Smart Wildcard**: A heuristic-generated pattern that replaces dynamic arguments with `*`.

## Edge Cases

- **Nested Operators**: Pipelines like `cmd1 && (cmd2 | cmd3)` must be recursively decomposed.
- **Precedence**: Deny rules always win over allow rules.
- **Sensitive Commands**: Commands like `rm` are blacklisted from smart wildcard suggestions to prevent accidental broad permissions.
- **Escaped Characters**: `echo "&&"` must be treated as a single command, not split.
