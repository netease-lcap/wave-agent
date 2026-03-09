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
