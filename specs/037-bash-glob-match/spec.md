# Feature Specification: Glob Pattern Match for Trusted Bash Commands

**Feature Branch**: `037-bash-glob-match`  
**Created**: 2025-12-27  
**Status**: Implemented  
**Input**: User description: "Bash rules support glob patterns with *. Wildcards can appear at any position in the command. This configuration allows npm and git commit commands while blocking git push:
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(git commit *)",
      "Bash(git * main)",
      "Bash(* --version)",
      "Bash(* --help *)"
    ],
    "deny": [
      "Bash(git push *)"
    ]
  }
}
 remove The legacy :* suffix syntax"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trusting a Command with Dynamic Arguments (Priority: P1)

As a user, I want to trust a command like `git commit -m "initial commit"` so that I am not prompted again when I run `git commit -m "another message"`.

**Why this priority**: This is the core requirement. It solves the "not smart" exact matching problem for common developer workflows.

**Independent Test**: Can be tested by running a command with dynamic arguments, selecting "Yes, and don't ask again", and then running the same command with different arguments to verify it executes without a prompt.

**Acceptance Scenarios**:

1. **Given** the system prompts for a bash command `npm install lodash`, **When** the user selects "Yes, and don't ask again", **Then** the system should identify a smart glob pattern (e.g., `npm install *`) and save it.
2. **Given** `npm install *` is a trusted pattern, **When** the user runs `npm install express`, **Then** the command should execute immediately without prompting.
3. **Given** `npm install *` is a trusted pattern, **When** the user runs `npm test`, **Then** the system SHOULD still prompt the user (as it doesn't match the pattern).

---

### User Story 2 - Reviewing the Smart Pattern (Priority: P2)

As a user, I want to see what glob pattern the system is going to trust before it is saved, so I can ensure it's not too broad or dangerous.

**Why this priority**: Important for security and user control. Prevents the system from accidentally trusting something like `rm -rf *` if the user only meant to trust `rm -rf ./tmp`.

**Independent Test**: Can be tested by observing the UI/prompt when "Yes, and don't ask again" is selected.

**Acceptance Scenarios**:

1. **Given** a user selects "Yes, and don't ask again", **When** the system determines the pattern, **Then** it should display the pattern to the user for confirmation.

---

### User Story 3 - Managing Trusted Patterns (Priority: P3)

As a user, I want to be able to view and remove trusted patterns from my settings.

**Why this priority**: Necessary for maintenance and correcting mistakes.

**Independent Test**: Can be tested by checking the settings file or a management UI (if applicable) and removing an entry.

**Acceptance Scenarios**:

1. **Given** several trusted patterns exist, **When** the user opens the settings, **Then** they should be able to identify and delete specific patterns.

---

### Edge Cases

- **Dangerous Commands**: What happens if a user tries to trust a command that could be dangerous if pattern-matched (e.g., `sudo rm *`)? The system maintains a hard blacklist of commands (e.g., `rm`, `sudo`, `dd`) that can NEVER be pattern-matched; they always require exact matches or manual approval.
- **Overlapping Patterns**: How does the system handle a situation where multiple patterns might match? (e.g., `git *` and `git commit *`).
- **Short Patterns**: How does the system prevent users from accidentally trusting extremely short patterns like `*`?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement a heuristic to extract a "smart glob pattern" from a bash command.
- **FR-002**: The smart pattern heuristic SHOULD include the base executable and any subcommands or flags that are likely to be static (e.g., `git push *`, `pnpm install *`, `python -m pip install *`, `mvn test *`, `docker run *`, `cargo build *`, `kubectl get *`).
- **FR-003**: System MUST store trusted patterns in `settings.local.json` (or equivalent configuration).
- **FR-004**: System MUST distinguish between "exact match" and "glob pattern match" entries in the settings.
- **FR-005**: When a bash command is about to be executed, the system MUST check if it matches any trusted exact commands OR matches any trusted glob patterns.
- **FR-006**: System MUST allow the user to confirm or edit the suggested pattern when they select "Yes, and don't ask again".
- **FR-007**: System MUST NOT allow pattern matching for commands that are deemed highly sensitive. A predefined list of common dangerous commands (e.g., `rm`, `mv`, `chmod`, `chown`, `sudo`, `sh`, `bash`) MUST be used to enforce this restriction.

### Key Entities *(include if feature involves data)*

- **TrustedCommand**: Represents a command the user has approved.
  - `pattern`: The string to match (exact or glob).
  - `type`: Enum (`EXACT`, `GLOB`).
  - `addedAt`: Timestamp.
  - `lastUsed`: Timestamp.

## Assumptions

- The user is comfortable with the system identifying common subcommands (like `install` in `npm install`) as part of the pattern.
- `settings.local.json` is the appropriate place for these user-specific trust settings.
- The "smart" part of the pattern match refers to ignoring dynamic arguments like file paths, commit messages, or package names by using wildcards.
