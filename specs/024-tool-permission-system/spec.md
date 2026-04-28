# Feature Specification: Tool Permission System

**Feature Branch**: `024-tool-permission-system`  
**Input**: Comprehensive merge of tool permission features including basic modes, wildcard matching, secure pipeline validation, deny rules, persistent configuration, interactive trust, acceptEdits mode, dontAsk mode, and secure file access (Safe Zone).

## Overview

The Tool Permission System provides a robust security layer for the Wave agent, ensuring that potentially destructive or sensitive operations are authorized by the user. It supports multiple permission modes, fine-grained rule matching with wildcards, secure decomposition of shell pipelines, explicit denial of specific tools or paths, persistent configuration across user and project scopes, interactive trust mechanisms, and a "Safe Zone" for file operations.

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

### User Story 8 - Built-in Safe Commands (Priority: P3)

As a user, I want common safe commands (like `cd` and `find`) to be automatically permitted by default. `cd` should be restricted to the current working directory, while `find` should be allowed for read-only purposes but blocked if it uses dangerous flags like `-delete` or `-exec`.

**Acceptance Scenarios**:
1. **Given** the CWD is `/home/user/project`, **When** the user executes `cd src`, **Then** the system SHOULD automatically permit it.
2. **Given** the CWD is `/home/user/project`, **When** the user executes `cd /etc`, **Then** the system MUST NOT automatically permit it.
3. **Given** any directory, **When** the user executes `find . -name "*.ts"`, **Then** the system SHOULD automatically permit it.
4. **Given** any directory, **When** the user executes `find . -delete`, **Then** the system MUST NOT automatically permit it and MUST prompt for permission.

### User Story 9 - MCP Tool Permissions (Priority: P1)

As a user, I want MCP tools to be subject to the same permission checks as built-in restricted tools, so that I can control which external tools the agent can execute.

**Acceptance Scenarios**:
1. **Given** an MCP tool (prefixed with `mcp__`) is called, **When** no matching permission rule exists, **Then** the system MUST prompt for confirmation.
2. **Given** a confirmation prompt for an MCP tool, **When** the user selects "Yes, and don't ask again", **Then** the system MUST save a persistent rule in the format `mcp__server__tool`.
3. **Given** a persistent rule `mcp__server__tool` exists, **When** the agent calls that specific MCP tool, **Then** it MUST execute immediately without prompting.

### User Story 10 - Programmatic and Session-specific Permissions (Priority: P1)

As a developer using the SDK or a user on the CLI, I want to provide temporary permission rules (both allowed and disallowed) that apply only to the current agent instance or session. This allows for fine-grained security control without modifying global settings.

**Acceptance Scenarios**:
1. **Given** an Agent created via SDK with `disallowedTools: ["Bash(rm *)"]`, **When** the AI attempts to run `rm -rf /`, **Then** the operation is denied even if `Bash` is otherwise allowed.
2. **Given** the CLI is started with `--allowedTools "Bash(git status)"`, **When** the agent runs `git status`, **Then** it is auto-approved for that session only.
3. **Given** an agent configured with `tools: ["Bash"]` (filtering) and `disallowedTools: ["Bash(rm *)"]` (permissions), **When** the AI attempts `ls`, **Then** it is allowed; **When** it attempts `rm`, **Then** it is denied.

### User Story 11 - Configure Permission Mode (Priority: P1)

A developer who frequently needs to bypass permissions for their development workflow wants to avoid typing `--dangerously-skip-permissions` every time. They want to set a persistent configuration that makes bypassing permissions the default behavior for their project.

**Acceptance Scenarios**:
1. **Given** a project with no `permissionMode` setting, **When** user runs agent commands, **Then** default permission mode behavior applies (requires confirmation for restricted tools).
2. **Given** `settings.json` contains `"permissions": {"permissionMode": "bypassPermissions"}`, **When** user runs agent commands, **Then** permissions are bypassed without prompting.
3. **Given** `settings.json` contains `"permissions": {"permissionMode": "default"}`, **When** user runs agent commands, **Then** user is prompted for confirmation on restricted tools.
4. **Given** `settings.json` contains an invalid `permissionMode` value, **When** agent starts, **Then** system falls back to default permission behavior and logs a warning.

### User Story 12 - Auto-accept File Edits from Prompt (Priority: P1)

As a user, when I am prompted to confirm a file edit or directory creation, I want to be able to choose to auto-accept all future edits in the current session, so that I don't have to confirm each one individually.

**Acceptance Scenarios**:
1. **Given** the agent is in `default` mode, **When** the agent attempts a `Write` or `mkdir` operation, **Then** the confirmation prompt shows an option: "Yes, and auto-accept edits".
2. **Given** the confirmation prompt for a `Write` or `mkdir` operation is shown, **When** the user selects "Yes, and auto-accept edits", **Then** the current operation is executed, and the agent's permission mode is set to `acceptEdits`.
3. **Given** the agent's permission mode was set to `acceptEdits` via the prompt, **When** the agent attempts a subsequent `Edit` or `mkdir` operation, **Then** it is executed without a prompt.

### User Story 13 - Persistent Bash Command Permission (Priority: P1)

As a user, when I am prompted to confirm a Bash command, I want to be able to allow that specific command to run without asking again in the current project, so that I can automate repetitive tasks safely.

**Acceptance Scenarios**:
1. **Given** the agent is in `default` mode, **When** the agent attempts a `Bash` operation with command `ls`, **Then** the confirmation prompt shows an option: "Yes, and don't ask again for this command in this workdir".
2. **Given** the confirmation prompt for `Bash` command `ls` is shown, **When** the user selects "Yes, and don't ask again...", **Then** the command is executed, and `Bash(ls)` is added to the `permissions.allow` array in `.wave/settings.local.json`.
3. **Given** `Bash(ls)` is in the `permissions.allow` array of the local project settings, **When** the agent attempts a `Bash` operation with command `ls`, **Then** it is executed without a prompt.

### User Story 14 - Automatic File Edits in Safe Zone (Priority: P1)

As a user, I want the agent to automatically apply file edits within my project directory or explicitly allowed directories without asking for my permission every time, so that I can work more efficiently when I trust the agent's changes.

**Acceptance Scenarios**:
1. **Given** the agent is in `acceptEdits` mode and the file is within the Safe Zone (CWD or `additionalDirectories`), **When** the agent attempts to use `Edit`, `Delete`, or `Write` tools, **Then** the operation is applied immediately without a permission prompt.
2. **Given** the agent is in `acceptEdits` mode and the directory is within the Safe Zone, **When** the agent attempts to use `mkdir` via the `Bash` tool, **Then** the operation is applied immediately without a permission prompt.

### User Story 15 - Out-of-Bounds Security Confirmation (Priority: P1)

As a user, I want the system to ask for my explicit permission before modifying any file outside of my project or allowed directories, even if I have enabled auto-accept mode, so that I can prevent accidental or malicious changes to my system.

**Acceptance Scenarios**:
1. **Given** a file located outside the Safe Zone, **When** the system attempts to write or edit the file, **Then** a confirmation prompt is displayed to the user, regardless of the `acceptEdits` setting.
2. **Given** the system is in `acceptEdits` mode, **When** an out-of-bounds file operation is attempted, **Then** the system MUST still display a confirmation prompt instead of automatically proceeding.

### User Story 16 - CLI Mode Cycling (Priority: P2)

As a CLI user, I want to quickly switch between permission modes during a session using a keyboard shortcut, so that I can easily toggle between manual control, automatic edits, planning, and bypass.

**Acceptance Scenarios**:
1. **Given** a CLI session is active and in `default` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to `acceptEdits`.
2. **Given** the CLI is in `acceptEdits` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to `plan`.
3. **Given** the CLI is in `plan` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to `bypassPermissions`.
4. **Given** the CLI is in `bypassPermissions` mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes back to `default`.

### User Story 17 - Auto-deny unapproved tools (Priority: P1)

As a user, I want tools that are not pre-approved to be automatically denied when I am in `dontAsk` mode, so that I am not interrupted by permission requests for tools I haven't explicitly allowed.

**Acceptance Scenarios**:
1. **Given** the permission mode is set to `dontAsk` and `Bash` is NOT in `permissions.allow`, **When** the agent calls `Bash`, **Then** the tool call is denied immediately and the agent receives a "permission denied" error without the user being prompted.

### User Story 18 - Configure dontAsk mode (Priority: P2)

As a user, I want to be able to set the permission mode to `dontAsk` in my configuration so that I can enforce this behavior across sessions.

**Acceptance Scenarios**:
1. **Given** the configuration file has `permissionMode: "dontAsk"`, **When** the agent starts, **Then** the effective permission mode is `dontAsk`.

### User Story 19 - Bash Heredoc Write Redirection to Dedicated Tools (Priority: P1)

As a user, I want the agent to use the dedicated `Write` and `Edit` tools for file modifications instead of bash heredoc redirections (e.g., `cat <<EOF > file`), so that I have better visibility and control over file changes.

**Acceptance Scenarios**:
1. **Given** the agent attempts to run a bash command with heredoc write redirection (e.g., `cat <<EOF > file.txt`), **When** the command is executed, **Then** the system MUST automatically deny the operation and provide a reminder to use the `Write` or `Edit` tools.
2. **Given** the agent attempts to run a simple bash command with write redirection (e.g., `npm start > app.log`), **When** the command is executed, **Then** the system SHOULD NOT automatically deny it based on heredoc write redirection rules (though it may still require normal bash permissions and be treated as dangerous).
3. **Given** the agent attempts to run a bash command with stream redirection (e.g., `ls 2>&1`), **When** the command is executed, **Then** the system SHOULD NOT treat it as a write redirection.

## Requirements

### Functional Requirements

#### Permission Modes & UI
- **FR-001**: Agent MUST support `permissionMode` values: "default", "bypassPermissions", "acceptEdits", "plan", "dontAsk".
- **FR-002**: Wave CLI MUST support `--dangerously-skip-permissions` to set mode to "bypassPermissions".
- **FR-003**: CLI MUST provide a confirmation component for restricted tools in "default" mode.
- **FR-004**: Confirmation component MUST support "Yes", "Yes, and don't ask again", "Yes, and auto-accept edits" (for FS tools), and alternative instructions via text input.
- **FR-005**: System MUST support a `canUseTool` callback in the Agent SDK for custom permission logic.
- **FR-006**: System MUST support cycling through permission modes (default -> acceptEdits -> plan -> bypassPermissions) via `Shift+Tab`.
- **FR-021**: System MUST hide the "Don't ask again" option for commands identified as dangerous or out-of-bounds.
- **FR-022**: System MUST automatically deny bash commands with heredoc write redirections (`cat <<EOF > file`) and remind the agent to use the dedicated `Write` or `Edit` tools for file modifications.
- **FR-056**: System MUST detect write redirections (`>`, `>>`, etc.) in bash commands and treat them as dangerous, hiding the "Don't ask again" option.
- **FR-057**: System MUST ignore file descriptor redirections (e.g., `2>&1`) when detecting write redirections.
- **FR-036**: Selecting "Yes, and auto-accept edits" MUST set the current session's permission mode to `acceptEdits`.
- **FR-037**: Selecting "Yes, and don't ask again for this command in this workdir" MUST save the rule `Bash([command])` to the `permissions.allow` array in `.wave/settings.local.json`.
- **FR-045**: In `acceptEdits` mode, the system MUST automatically grant permission for `Edit`, `Delete`, and `Write` operations within the Safe Zone.
- **FR-046**: In `dontAsk` mode, the system MUST auto-deny any restricted tool call that does not match a rule in `permissions.allow` or `temporaryRules`.
- **FR-047**: In `dontAsk` mode, the system MUST NOT invoke the `canUseToolCallback` (which typically triggers user prompts) for unapproved restricted tools.
- **FR-048**: The `dontAsk` mode MUST NOT be included in the cycle of permission modes triggered by the "Shift+Tab" shortcut.
- **FR-049**: When `dontAsk` mode is active, the system MUST inject a message into the agent's system prompt stating: "Tools are executed in a 'user-selected permission mode'. Permissions can be configured via settings.json and settings.local.json."

#### Safe Zone & Secure File Access
- **FR-050**: System MUST identify the "Safe Zone" as the union of the current working directory and all paths listed in `permissions.additionalDirectories`.
- **FR-051**: System MUST intercept all file modification operations (Write, Edit, Delete, and `mkdir` via Bash).
- **FR-052**: System MUST verify if the target file path of a modification operation is within the Safe Zone.
- **FR-053**: System MUST display a confirmation prompt for any modification operation targeting a file outside the Safe Zone, regardless of the `permissionMode` setting (except `bypassPermissions`).
- **FR-054**: System MUST support both absolute paths and paths relative to the working directory in `permissions.additionalDirectories`.
- **FR-055**: System MUST resolve symbolic links to their absolute real paths before performing the Safe Zone check.

#### Configuration & Persistence
- **FR-038**: System MUST support a `permissionMode` setting in `permissions` object in `settings.json`.
- **FR-039**: System MUST apply the configured `permissionMode` as the default permission behavior when no command-line permission flags are provided.
- **FR-040**: Command-line permission flags MUST override any configured `permissionMode` setting for that specific execution.
- **FR-041**: System MUST validate `permissionMode` values and fall back to standard default behavior for invalid configurations.
- **FR-042**: The `permissionMode` setting MUST work at user-level, project-level, and local project settings files, with precedence: `settings.local.json` > `settings.json` (project) > `settings.json` (user).
- **FR-043**: On startup, the system MUST load `permissions.allow` from all applicable `settings.json` files.
- **FR-044**: The system MUST create the `.wave` directory and `settings.local.json` file if they do not exist when saving a local permission rule.

#### MCP Tool Permissions
- **FR-026**: System MUST treat any tool name starting with `mcp__` as a restricted tool.
- **FR-027**: System MUST trigger a permission check before executing any MCP tool.
- **FR-028**: System MUST support persistent permission rules for MCP tools in the format `mcp__server__tool`.
- **FR-029**: System MUST propagate the `ToolContext` to MCP tool execution functions to enable permission enforcement.

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
- **FR-018**: System MUST maintain a built-in list of safe commands (`cd`, `ls`, `pwd`, `mkdir`, `find`) that are permitted if they meet safety criteria.
- **FR-019**: Built-in safe commands attempting to access paths outside the CWD (e.g., `cd ..`, `ls /etc`) MUST require explicit permission.
- **FR-019.1**: `find` MUST be considered safe only if it does not contain dangerous flags like `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprint`, `-fprint0`, or `-fprintf`.

#### Programmatic and Session-specific Permissions
- **FR-030**: The `AgentOptions` interface in the SDK MUST include optional `allowedTools` and `disallowedTools` properties of type `string[]`.
- **FR-031**: The CLI MUST support `--allowedTools` and `--disallowedTools` flags that accept comma-separated strings of rules.
- **FR-032**: Rules provided via SDK or CLI MUST be instance-specific or session-specific and MUST NOT be persisted to `settings.json` automatically.
- **FR-033**: `tools` and the permission rules MUST operate independently: `tools` filters available tool definitions (visibility), while `allowedTools`/`disallowedTools` define execution permissions.
- **FR-034**: `disallowedTools` MUST take precedence over `allowedTools` if a tool call matches both.
- **FR-035**: If `disallowedTools` or `permissions.deny` contains rules that consist only of a tool name (e.g., `"Bash"`, `"Write"`), the system MUST filter out these tools from the available tools list provided to the AI, effectively combining visibility and execution control.

## Key Entities

- **Permission Mode**: Configuration determining the level of user intervention required.
- **Permission Rule**: A string defining a permitted or denied action (e.g., `Bash(git *)`, `Read(**/*.env)`).
- **Simple Command**: A single executable command with its arguments, extracted from a pipeline.
- **Smart Wildcard**: A heuristic-generated pattern that replaces dynamic arguments with `*`.
- **PermissionDecision**: The result of a permission check, extended to include optional `newPermissionMode` and `newPermissionRule` to signal the system to update its state.
- **Safe Zone**: A collection of filesystem paths where the agent is permitted to perform file operations without explicit per-operation user confirmation.
- **Additional Directories**: A user-configurable list of paths that extend the Safe Zone beyond the default working directory.

## Edge Cases

- **Nested Operators**: Pipelines like `cmd1 && (cmd2 | cmd3)` must be recursively decomposed.
- **Precedence**: Deny rules always win over allow rules.
- **Sensitive Commands**: Commands like `rm` are blacklisted from smart wildcard suggestions to prevent accidental broad permissions.
- **Escaped Characters**: `echo "&&"` must be treated as a single command, not split.
- **Missing `.wave` directory**: If the user selects the persistent Bash option and `.wave` doesn't exist, the system should create it.
- **Malformed `settings.json`**: If the settings file is malformed, the system should handle it gracefully.
- **Duplicate rules**: If the rule already exists, selecting the option again should not create a duplicate.
- **Restricted vs Unrestricted Tools**: Unrestricted tools (those not in `RESTRICTED_TOOLS`) should still be allowed automatically, even in `dontAsk` mode.
- **Symbolic Links**: The system should resolve the real path and check it against the safe zones to prevent bypasses via symlinks.
- **Nested Directories**: Any file within a listed directory or its subdirectories should be considered safe.
