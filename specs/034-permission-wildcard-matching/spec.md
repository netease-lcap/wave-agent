# Feature Specification: Permission Wildcard Matching

**Feature Branch**: `034-permission-wildcard-matching`  
**Created**: 2025-12-26  
**Status**: Implemented  
**Input**: User description: "permissions.allow array should support wildcard matching with *, wildcards can appear at any position in the command"

- [x] US1: Wildcard Matching for Commands
- [x] US2: Exact Matching
- [x] US3: Wildcard Support

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Wildcard Matching for Commands (Priority: P1)

As a user, I want to allow a group of related commands by specifying a common pattern with wildcards, so that I don't have to list every single variation of a command in my permissions.

**Why this priority**: This is the core requirement of the feature. It enables more flexible and maintainable permission configurations.

**Independent Test**: Can be tested by adding a pattern like `Bash(git commit *)` to `permissions.allow` and verifying that `Bash(git commit -m "feat: add something")` is allowed while `Bash(git push)` is denied.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `Bash(git commit *)`, **When** the agent attempts to run `Bash(git commit -m "initial commit")`, **Then** the action is allowed.
2. **Given** `permissions.allow` contains `Bash(git commit *)`, **When** the agent attempts to run `Bash(git commit --amend)`, **Then** the action is allowed.
3. **Given** `permissions.allow` contains `Bash(git commit *)`, **When** the agent attempts to run `Bash(git status)`, **Then** the action is denied.

---

### User Story 2 - Exact Matching (Priority: P2)

As a user, I want to ensure that exact matching still works as expected, so that I can restrict permissions to specific commands when needed.

**Why this priority**: Ensures backward compatibility and precise control.

**Independent Test**: Can be tested by adding `Bash(ls -la)` to `permissions.allow` and verifying that only that exact command works.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `Bash(ls -la)`, **When** the agent attempts to run `Bash(ls -la)`, **Then** the action is allowed.
2. **Given** `permissions.allow` contains `Bash(ls -la)`, **When** the agent attempts to run `Bash(ls -lah)`, **Then** the action is denied.

---

### User Story 3 - Wildcard Support (Priority: P3)

As a user, I want the `*` wildcard to work at any position in a pattern, so that I can allow commands with variable parts in the middle.

**Why this priority**: Flexibility and power.

**Independent Test**: Can be tested by adding `Bash(git * main)` and verifying it matches `git push origin main` and `git pull origin main`.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `Bash(git * main)`, **When** the agent attempts to run `Bash(git push origin main)`, **Then** the action is allowed.
2. **Given** `permissions.allow` contains `Bash(git * main)`, **When** the agent attempts to run `Bash(git pull origin main)`, **Then** the action is allowed.

---

### Edge Cases

- **Empty Pattern**: What happens if the pattern is just `*`? (Assumption: It should match everything, effectively allowing all commands if that's the whole pattern, but usually it would be within a tool call like `Bash(*)`).
- **Multiple Wildcards**: How does `Bash(git * commit * -m *)` behave? (Assumption: It matches any git command that has commit and -m in that order).
- **No Wildcard**: Does `git commit` work? (Requirement: Yes, it matches exactly).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support exact string matching for entries in `permissions.allow`.
- **FR-002**: System MUST support wildcard matching if an entry in `permissions.allow` contains `*`.
- **FR-003**: When an entry contains `*`, the system MUST allow any command that matches the wildcard pattern.
- **FR-004**: System MUST support wildcards at any position in the pattern.
- **FR-005**: The legacy `:*` suffix syntax is NO LONGER supported as a special marker and will be treated as literal characters unless it matches a wildcard.

### Key Entities *(include if feature involves data)*

- **Permission Pattern**: A string defined in the `permissions.allow` configuration. It can be an "Exact Pattern" or a "Wildcard Pattern" (if it contains `*`).
- **Action String**: The string representation of the action being performed (e.g., `Bash(git commit -m "msg")`), which is checked against the Permission Patterns.
