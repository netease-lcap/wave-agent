# Feature Specification: Permission Prefix Matching

**Feature Branch**: `034-permission-prefix-matching`  
**Created**: 2025-12-26  
**Status**: Implemented  
**Input**: User description: "permissions.allow array should support prefix matching, like Bash(git commit:*), not regex, not wildcard, :* only works at the end of a pattern to match any continuation"

- [x] US1: Prefix Matching for Commands
- [x] US2: Exact Matching
- [x] US3: Strict Prefix Marker

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prefix Matching for Commands (Priority: P1)

As a user, I want to allow a group of related commands by specifying a common prefix, so that I don't have to list every single variation of a command in my permissions.

**Why this priority**: This is the core requirement of the feature. It enables more flexible and maintainable permission configurations.

**Independent Test**: Can be tested by adding a pattern like `Bash(git commit:*)` to `permissions.allow` and verifying that `Bash(git commit -m "feat: add something")` is allowed while `Bash(git push)` is denied.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `Bash(git commit:*)`, **When** the agent attempts to run `Bash(git commit -m "initial commit")`, **Then** the action is allowed.
2. **Given** `permissions.allow` contains `Bash(git commit:*)`, **When** the agent attempts to run `Bash(git commit --amend)`, **Then** the action is allowed.
3. **Given** `permissions.allow` contains `Bash(git commit:*)`, **When** the agent attempts to run `Bash(git status)`, **Then** the action is denied.

---

### User Story 2 - Exact Matching (Priority: P2)

As a user, I want to ensure that exact matching still works as expected, so that I can restrict permissions to specific commands when needed.

**Why this priority**: Ensures backward compatibility and precise control.

**Independent Test**: Can be tested by adding `Bash(ls -la)` to `permissions.allow` and verifying that only that exact command works.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `Bash(ls -la)`, **When** the agent attempts to run `Bash(ls -la)`, **Then** the action is allowed.
2. **Given** `permissions.allow` contains `Bash(ls -la)`, **When** the agent attempts to run `Bash(ls -lah)`, **Then** the action is denied.

---

### User Story 3 - Strict Prefix Marker (Priority: P3)

As a user, I want the `:*` marker to only work at the end of a pattern, so that I don't accidentally allow unintended commands through middle-of-string wildcards.

**Why this priority**: Security and predictability. Prevents misinterpretation of the `:*` sequence if it appears elsewhere.

**Independent Test**: Can be tested by adding `Bash(echo :* test)` and verifying it only matches that exact string, not as a wildcard.

**Acceptance Scenarios**:

1. **Given** `permissions.allow` contains `Bash(echo :* test)`, **When** the agent attempts to run `Bash(echo hello test)`, **Then** the action is denied.
2. **Given** `permissions.allow` contains `Bash(echo :* test)`, **When** the agent attempts to run `Bash(echo :* test)`, **Then** the action is allowed.

---

### Edge Cases

- **Empty Prefix**: What happens if the pattern is just `:*`? (Assumption: It should match everything starting with an empty string, effectively allowing all commands if that's the whole pattern, but usually it would be within a tool call like `Bash(:*)`).
- **Multiple Colons**: How does `Bash(git::*)` behave? (Assumption: It matches anything starting with `Bash(git::`).
- **No Colon**: Does `git*` work? (Requirement: No, only `:*` at the end works for prefix matching).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support exact string matching for entries in `permissions.allow`.
- **FR-002**: System MUST support prefix matching if an entry in `permissions.allow` ends with the literal sequence `:*`.
- **FR-003**: When an entry ends with `:*`, the system MUST allow any command that starts with the string preceding the `:*`.
- **FR-004**: System MUST NOT support regex or any other wildcard characters (e.g., `*`, `?`, `[]`) unless they are part of the literal string being matched.
- **FR-005**: The `:*` sequence MUST only be treated as a prefix match indicator when it occurs at the very end of the pattern string.
- **FR-006**: If `:*` appears anywhere else in the pattern, it MUST be treated as a literal string.

### Key Entities *(include if feature involves data)*

- **Permission Pattern**: A string defined in the `permissions.allow` configuration. It can be an "Exact Pattern" or a "Prefix Pattern" (if it ends in `:*`).
- **Action String**: The string representation of the action being performed (e.g., `Bash(git commit -m "msg")`), which is checked against the Permission Patterns.
