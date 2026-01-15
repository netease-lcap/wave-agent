# Feature Specification: Support permissions.deny in settings.json

**Feature Branch**: `049-deny-permissions-support`  
**Created**: 2026-01-15  
**Status**: Draft  
**Input**: User description: "support permissions.deny in settings.json, having same permission rule like permissions.allow, but deny them."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deny specific tool access (Priority: P1)

As a security-conscious user, I want to explicitly forbid the agent from using certain powerful tools (like `Bash` or `Write`) to ensure it cannot make unauthorized changes to my system, even if those tools are generally available.

**Why this priority**: This is the core functionality requested. It provides immediate security value by allowing users to restrict the agent's capabilities.

**Independent Test**: Can be tested by adding a tool name to `permissions.deny` in `settings.json` and verifying that the agent is unable to execute that tool, receiving a "permission denied" error instead.

**Acceptance Scenarios**:

1. **Given** `permissions.deny` contains `["Bash"]`, **When** the agent attempts to run a bash command, **Then** the system MUST block the execution and inform the user/agent that the tool is explicitly denied.
2. **Given** `permissions.deny` is empty or does not contain `Bash`, **When** the agent attempts to run a bash command (and it's allowed by other rules), **Then** the system SHOULD allow the execution.
3. **Given** `permissions.deny` contains `["Bash(rm:*)"]`, **When** the agent attempts to run `rm -rf /`, **Then** the system MUST block the execution.

---

### User Story 2 - Deny access to specific file paths (Priority: P1)

As a user with sensitive data, I want to prevent the agent from accessing specific directories or files (e.g., `.env` files, SSH keys, or system configuration directories) by defining deny rules for tools that operate on specific file paths.

**Why this priority**: Protecting sensitive data is a primary use case for permissions. Deny rules are often easier to manage for "everything except X" or "allow all except Y" scenarios.

**Independent Test**: Can be tested by adding a rule like `Read(**/.env)` or `Delete(/etc/**)` to `permissions.deny` and verifying that the corresponding tool is blocked when attempting to access matching paths.

**Acceptance Scenarios**:

1. **Given** `permissions.deny` contains `["Read(**/.env)"]`, **When** the agent attempts to read a file named `.env` in any directory using the `Read` tool, **Then** the system MUST deny the request.
2. **Given** `permissions.deny` contains `["Write(/etc/**)"]`, **When** the agent attempts to write to a file in `/etc/` using the `Write` tool, **Then** the system MUST deny the request.
3. **Given** `permissions.deny` contains `["Delete(/etc/**)"]`, **When** the agent attempts to delete a file in `/etc/`, **Then** the system MUST deny the request.
4. **Given** `permissions.deny` contains `["Bash(ls /etc:*)"]`, **When** the agent attempts to run `ls /etc/passwd`, **Then** the system MUST deny the request.

---

### User Story 3 - Precedence of Deny over Allow (Priority: P2)

As a user, I want to be certain that if I explicitly deny a permission, it cannot be overridden by an allow rule. This "deny-by-default" for specific items ensures predictable security.

**Why this priority**: Ensures the security model is robust and follows the principle of least privilege. It resolves potential conflicts between allow and deny rules.

**Independent Test**: Can be tested by adding the same resource/tool to both `permissions.allow` and `permissions.deny` and verifying that the request is denied.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `["*"]` and `permissions.deny` contains `["Bash"]`, **When** the agent attempts to run a bash command, **Then** the system MUST deny the request because the deny rule takes precedence.

---

### Edge Cases

- **What happens when a deny rule is malformed?** The system should ideally log a warning and treat the malformed rule as "deny nothing" (to avoid breaking the whole system) or "deny everything" (for maximum safety). Given the context, a warning and ignoring the specific malformed rule is standard, but for security, it might be better to fail safe. **Assumption**: Malformed rules will be ignored with a warning, but valid rules will still be enforced.
- **How does the system handle overlapping glob patterns?** If multiple deny rules match, the result is still "denied".
- **What if `settings.json` is missing `permissions.deny`?** The system should behave as it currently does, only relying on `permissions.allow` and default behaviors.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a `permissions.deny` field in `settings.json`.
- **FR-002**: `permissions.deny` MUST support the same rule types and formats as `permissions.allow` (e.g., tool names, `Bash(cmd)`, `Bash(prefix:*)`).
- **FR-003**: System MUST support path-based permission rules in the format `ToolName(path_pattern)` for both `allow` and `deny` lists. This MUST apply to tools that take a single file or directory path as a primary input (e.g., `Read`, `Write`, `Edit`, `MultiEdit`, `Delete`, `LS`). Tools like `Glob` and `Grep` are excluded from this path-based rule format as their path parameter is optional and they often operate on patterns.
- **FR-004**: If a permission request matches any rule in `permissions.deny`, the system MUST deny the request immediately, even if the tool is not in the `RESTRICTED_TOOLS` list and even if it would otherwise be allowed by `permissions.allow` or auto-accept logic.
- **FR-005**: `permissions.deny` MUST take precedence over `permissions.allow`. If a request matches both an allow rule and a deny rule, it MUST be denied.
- **FR-006**: The system MUST provide a clear and informative error message when a permission is denied due to an explicit deny rule, distinguishing it from a lack of an allow rule.
- **FR-007**: The system MUST support hot-reloading of `permissions.deny` rules when `settings.json` is modified.
- **FR-008**: `permissions.deny` rules from different configuration sources (user, project, local) MUST be merged into a single unique set, similar to `permissions.allow`.
- **FR-009**: The system MUST validate that `permissions.deny` is an array of strings during configuration loading.

### Key Entities *(include if feature involves data)*

- **Permission Rule**: A string or object defining a capability (tool) or resource (file path) that is subject to access control.
- **Settings**: The configuration object loaded from `settings.json` which now includes both `allow` and `deny` permission lists.
