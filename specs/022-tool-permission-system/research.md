# Research Report: Tool Permission System

## Decision: Tool Execution Interception Pattern
**What was chosen**: Individual tool modification pattern, inserting permission checks within each restricted tool's execute method after validation/diff generation but before the actual operation.
**Why chosen**: Ensures permission check happens at the precise moment specified (after validation/diff, before real operation).

## Decision: Permission Callback Architecture
**What was chosen**: Optional `canUseTool` callback in `AgentOptions` with Promise-based API returning `{behavior: 'allow'} | {behavior: 'deny', message: string}`.
**Why chosen**: Provides flexibility for custom implementations and non-blocking async design.

## Decision: Wildcard Matching Implementation
**What was chosen**: Support `*` wildcard in `permissions.allow` and `permissions.deny`. Rules containing `*` are converted to regex for matching (for Bash) or use `minimatch` (for path-based tools).
**Why chosen**: Simple, flexible, and avoids the complexity of full regex for users.

## Decision: Heuristic-based Smart Wildcard Extraction
**What was chosen**: A heuristic-based approach to suggest wildcard patterns for common developer commands (git, npm, etc.).
**Why chosen**: Simpler and faster than a full bash parser while covering the most common use cases.
**Heuristic Details**:
- **Package Managers**: `npm`, `pnpm`, `yarn`, `pip`, `cargo`, `go`, `mvn`, `gradle`.
- **Version Control**: `git` (commit, push, pull, etc.).
- **Containers**: `docker`, `kubectl`.
- **Blacklist**: `rm`, `sudo`, `chmod`, `chown`, `mv` are never wildcard-suggested.

## Decision: Secure Pipeline Validation
**What was chosen**: Decompose complex bash commands (using `&&`, `|`, `;`, etc.) into "simple commands" and validate each one individually.
**Why chosen**: Prevents unauthorized commands from being smuggled into a chain while allowing legitimate chained workflows.

## Decision: Deny Rule Precedence
**What was chosen**: `permissions.deny` always takes precedence over `permissions.allow`.
**Why chosen**: Follows the principle of least privilege and ensures predictable security.

## Decision: Path-based Permission Rules
**What was chosen**: Support `ToolName(glob_pattern)` for tools like `Read`, `Write`, `Edit`, `Delete`, `LS`.
**Why chosen**: Allows fine-grained control over file system access (e.g., `Read(**/*.env)`).

## Decision: Built-in Safe Commands with Path Restrictions
**What was chosen**: Automatically permit `cd`, `ls`, `pwd` and read-only `git` commands, but restrict them to the CWD and its subdirectories.
**Why chosen**: Improves the "out-of-the-box" experience while maintaining a strong security boundary.

## Decision: Sequential Confirmation Architecture
**What was chosen**: Queue-based approach for handling multiple tool calls that require sequential confirmation prompts.
**Why chosen**: Provides clear state management and maintains user control for each individual tool call.

## Decision: Split Chained Commands on Save
**What was chosen**: When a user selects "Don't ask again" for a chained command, the system splits it into individual simple commands and saves only the non-safe ones to `permissions.allow`.
**Why chosen**: Ensures that users don't clutter their permissions list with safe commands while still getting the benefit of auto-allowing the dangerous parts of a chain.

## Decision: Programmatic and Session-specific Permissions
**What was chosen**: Added `allowedTools` and `disallowedTools` to `AgentOptions` in the SDK and corresponding flags to the CLI. These rules are instance/session-specific and not persisted to `settings.json`.
**Why chosen**: Provides a way to enforce temporary security constraints without modifying global configuration.

## Decision: Independent Filtering and Permissions
**What was chosen**: `tools` (filtering) and `allowedTools`/`disallowedTools` (permissions) operate independently.
**Why chosen**: Clear separation of concerns between tool visibility and execution control.

## Decision: Configuration Merging Strategy
**What was chosen**: `permissions.allow` will be merged by combining arrays from all levels (user and project).
**Why chosen**: Permissions are additive. If a user trusts a command globally, it should be trusted in all projects. If they trust it in a specific project, it should be trusted there.

## Decision: Settings Hierarchy Implementation
**What was chosen**: The existing configuration resolution follows: `settings.local.json` > `settings.json` (project) > `settings.json` (user), with command-line flags taking highest precedence.
**Why chosen**: Provides a clear and flexible way for users to manage their settings at different levels.

## Decision: Communication of State Changes
**What was chosen**: Extend `PermissionDecision` with `newPermissionMode?: PermissionMode` and `newPermissionRule?: string`.
**Why chosen**: Allows the UI to signal back to the `Agent` what side effects should occur as a result of the user's choice.

## Decision: dontAsk Mode Implementation
**What was chosen**: Auto-deny restricted tools not in allow list. Injects message into system prompt.
**Why chosen**: Provides a non-interactive mode for automated workflows while maintaining security.

## Decision: Safe Zone Implementation
**What was chosen**: Implement the "Safe Zone" as a union of the current working directory and a user-configurable list of additional directories (`permissions.additionalDirectories`).
**Why chosen**: Ensures that the agent only has auto-accept permissions within designated safe areas, providing a critical safety net for out-of-bounds file operations.
**Implementation Details**:
- Use `isPathInside` utility which handles absolute paths and symbolic links (via `fs.realpathSync`).
- Intercept file modification tools: `Write`, `Edit`, `Delete`, and `mkdir` via `Bash`.
- Out-of-bounds operations ALWAYS require confirmation, even in `acceptEdits` mode.
- Support both absolute and relative paths in `additionalDirectories`.
