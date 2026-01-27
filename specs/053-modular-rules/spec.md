# Feature Specification: Modular Rules

**Feature Branch**: `053-modular-rules`  
**Created**: 2026-01-27  
**Status**: Draft  
**Input**: User description: "modular-rules.md"

## Clarifications

### Session 2026-01-27
- Q: If a task involves multiple files, how should path-specific rules be activated? → A: Union: Activate all rules that match any of the files currently being read or modified in the task.
- Q: Which tool interactions or context signals should trigger the activation of a path-specific rule? → A: Any in Context: Any file currently loaded in the context window (via Read, Grep, etc.) or being written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Project-Level Modular Rules (Priority: P1)

As a developer, I want to organize project instructions into multiple files within a `.wave/rules/` directory so that I can maintain focused rule files instead of one large `AGENTS.md`.

**Why this priority**: This is the primary goal of the feature—enabling modular organization of rules.

**Independent Test**: Create multiple `.md` files in `.wave/rules/` and verify they are automatically loaded as project memory with the same priority as `AGENTS.md`.

**Acceptance Scenarios**:

1. **Given** a project with `.wave/rules/code-style.md` and `.wave/rules/testing.md`, **When** Wave starts, **Then** both files should be loaded as project memory.
2. **Given** rules in `.wave/rules/`, **When** Wave performs a task, **Then** it should adhere to the instructions in those files.

---

### User Story 2 - Path-Specific Rules (Priority: P1)

As a developer, I want to scope rules to specific files using YAML frontmatter so that rules only apply when Wave is working with files matching specified patterns.

**Why this priority**: Essential for large projects where different directories (e.g., frontend vs. backend) have different requirements.

**Independent Test**: Create a rule with a `paths` field and verify it is only active when the agent is working on a matching file.

**Acceptance Scenarios**:

1. **Given** a rule with `paths: ["src/api/**/*.ts"]`, **When** Wave edits `src/api/user.ts`, **Then** the rule should be active.
2. **Given** the same rule, **When** Wave edits `src/ui/Button.tsx`, **Then** the rule should NOT be active.
3. **Given** a rule without a `paths` field, **When** Wave edits any file, **Then** the rule should always be active.

---

### User Story 3 - Rule Organization in Subdirectories (Priority: P2)

As a team lead, I want to organize rules into subdirectories within `.wave/rules/` and use symlinks to share rules across projects.

**Why this priority**: Improves maintainability for complex setups and enables cross-project standard enforcement.

**Independent Test**: Create subdirectories in `.wave/rules/` and symlinks to external rule files, then verify they are discovered and loaded.

**Acceptance Scenarios**:

1. **Given** rules in `.wave/rules/frontend/react.md`, **When** Wave loads rules, **Then** it should discover and load `react.md` from the subdirectory.
2. **Given** a symlink `.wave/rules/shared` pointing to an external directory, **When** Wave loads rules, **Then** it should resolve the symlink and load the rules within.

---

### User Story 4 - User-Level Rules (Priority: P2)

As a user, I want to define personal rules in `~/.wave/rules/` that apply across all my projects.

**Why this priority**: Allows users to maintain personal preferences (e.g., workflow, style) globally.

**Independent Test**: Create a rule in `~/.wave/rules/preferences.md` and verify it is loaded in any project.

**Acceptance Scenarios**:

1. **Given** a rule in `~/.wave/rules/`, **When** Wave starts in any project, **Then** the user-level rule should be loaded.
2. **Given** a conflict between a user-level rule and a project-level rule, **Then** the project-level rule should take priority.

---

### Edge Cases

- **Circular Symlinks**: How does the system handle symlinks that point back to themselves or create a loop? (Requirement: Detect and handle gracefully).
- **Invalid YAML**: How does the system handle a rule file with malformed frontmatter?
- **Brace Expansion**: Ensuring patterns like `{src,lib}/**/*.ts` are correctly expanded.
- **Empty Rules Directory**: System should not error if `.wave/rules/` is missing or empty.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST discover all `.md` files in `.wave/rules/` and its immediate subdirectories and load them as project memory.
- **FR-002**: System MUST support YAML frontmatter in rule files with a `paths` field containing a list of glob patterns.
- **FR-003**: System MUST apply path-specific rules if *any* file currently in the context window (read or modified) matches the glob patterns.
- **FR-011**: If multiple files are in context, the system MUST activate the union of all matching rules.
- **FR-004**: System MUST support standard glob patterns, including `**` for recursive matching and brace expansion (e.g., `*.{ts,tsx}`).
- **FR-005**: System MUST resolve symlinks within the `.wave/rules/` directory and load the target contents.
- **FR-006**: System MUST detect and gracefully handle circular symlinks to prevent infinite loops.
- **FR-007**: System MUST load user-level rules from `~/.wave/rules/`.
- **FR-008**: System MUST prioritize project-level rules over user-level rules when they are loaded.
- **FR-009**: Rules without a `paths` field MUST be loaded unconditionally.
- **FR-010**: Modular rules MUST have the same priority as `AGENTS.md` within the project context.

### Key Entities *(include if feature involves data)*

- **Rule File**: A Markdown file containing instructions, optionally with YAML frontmatter for scoping.
- **Glob Pattern**: A string used to match file paths (e.g., `src/**/*.ts`).
- **Rule Registry**: The internal system that manages discovered rules and determines which are active based on context.
