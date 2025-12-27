# Feature Specification: Smart Prefix Match for Trusted Bash Commands

**Feature Branch**: `037-bash-smart-prefix-match`  
**Created**: 2025-12-27  
**Status**: Draft  
**Input**: User description: "when user select \"Yes, and don't ask again\" for bash, system currently save exact commands to settings.local.json which is not smart, for example some bash contain string args which is dynamic, can you come up with a smart prefix match for \"\"Yes, and don't ask again\" bash?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trusting a Command with Dynamic Arguments (Priority: P1)

As a user, I want to trust a command like `git commit -m "initial commit"` so that I am not prompted again when I run `git commit -m "another message"`.

**Why this priority**: This is the core requirement. It solves the "not smart" exact matching problem for common developer workflows.

**Independent Test**: Can be tested by running a command with dynamic arguments, selecting "Yes, and don't ask again", and then running the same command with different arguments to verify it executes without a prompt.

**Acceptance Scenarios**:

1. **Given** the system prompts for a bash command `npm install lodash`, **When** the user selects "Yes, and don't ask again", **Then** the system should identify a smart prefix (e.g., `npm install`) and save it.
2. **Given** `npm install` is a trusted prefix, **When** the user runs `npm install express`, **Then** the command should execute immediately without prompting.
3. **Given** `npm install` is a trusted prefix, **When** the user runs `npm test`, **Then** the system SHOULD still prompt the user (as it doesn't match the prefix).

---

### User Story 2 - Reviewing the Smart Prefix (Priority: P2)

As a user, I want to see what prefix the system is going to trust before it is saved, so I can ensure it's not too broad or dangerous.

**Why this priority**: Important for security and user control. Prevents the system from accidentally trusting something like `rm -rf /` if the user only meant to trust `rm -rf ./tmp`.

**Independent Test**: Can be tested by observing the UI/prompt when "Yes, and don't ask again" is selected.

**Acceptance Scenarios**:

1. **Given** a user selects "Yes, and don't ask again", **When** the system determines the prefix, **Then** it should display the prefix to the user for confirmation.

---

### User Story 3 - Managing Trusted Prefixes (Priority: P3)

As a user, I want to be able to view and remove trusted prefixes from my settings.

**Why this priority**: Necessary for maintenance and correcting mistakes.

**Independent Test**: Can be tested by checking the settings file or a management UI (if applicable) and removing an entry.

**Acceptance Scenarios**:

1. **Given** several trusted prefixes exist, **When** the user opens the settings, **Then** they should be able to identify and delete specific prefixes.

---

### Edge Cases

- **Dangerous Commands**: What happens if a user tries to trust a command that could be dangerous if prefix-matched (e.g., `sudo rm`)? The system maintains a hard blacklist of commands (e.g., `rm`, `sudo`, `dd`) that can NEVER be prefix-matched; they always require exact matches or manual approval.
- **Overlapping Prefixes**: How does the system handle a situation where multiple prefixes might match? (e.g., `git` and `git commit`).
- **Short Prefixes**: How does the system prevent users from accidentally trusting extremely short prefixes like `a`?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement a heuristic to extract a "smart prefix" from a bash command.
- **FR-002**: The smart prefix heuristic SHOULD include the base executable and any subcommands or flags that are likely to be static (e.g., `git push`, `pnpm install`, `python -m pip install`, `mvn test`, `docker run`, `cargo build`, `kubectl get`).
- **FR-003**: System MUST store trusted prefixes in `settings.local.json` (or equivalent configuration).
- **FR-004**: System MUST distinguish between "exact match" and "prefix match" entries in the settings.
- **FR-005**: When a bash command is about to be executed, the system MUST check if it matches any trusted exact commands OR starts with any trusted prefixes.
- **FR-006**: System MUST allow the user to confirm or edit the suggested prefix when they select "Yes, and don't ask again".
- **FR-007**: System MUST NOT allow prefix matching for commands that are deemed highly sensitive. A predefined list of common dangerous commands (e.g., `rm`, `mv`, `chmod`, `chown`, `sudo`, `sh`, `bash`) MUST be used to enforce this restriction.

### Key Entities *(include if feature involves data)*

- **TrustedCommand**: Represents a command the user has approved.
  - `pattern`: The string to match (exact or prefix).
  - `type`: Enum (`EXACT`, `PREFIX`).
  - `addedAt`: Timestamp.
  - `lastUsed`: Timestamp.

## Assumptions

- The user is comfortable with the system identifying common subcommands (like `install` in `npm install`) as part of the prefix.
- `settings.local.json` is the appropriate place for these user-specific trust settings.
- The "smart" part of the prefix match refers to ignoring dynamic arguments like file paths, commit messages, or package names when they appear at the end of a command.
