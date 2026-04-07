# Feature Specification: Builtin Settings Skill

**Feature Branch**: `071-builtin-settings-skill`  
**Created**: 2026-03-18  
**Input**: User description: "support builtin settings skill, guide user how to write settings.json, explore codebase to learn current setting.json function. for complex hooks config, you should create another md and link to SKILL.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage Wave Settings via Skill (Priority: P1)

As a user, I want to be able to view and modify my Wave settings (user, project, or local) using a simple skill command, so I don't have to manually find and edit JSON files.

**Why this priority**: This is the core functionality requested. It provides immediate value by simplifying configuration management.

**Independent Test**: Can be fully tested by running the `settings` skill and verifying it can read and update settings in different scopes.

**Acceptance Scenarios**:

1. **Given** I have a `settings.json` file, **When** I run the `settings` skill to view my configuration, **Then** it should display the current settings from all applicable scopes.
2. **Given** I want to change a setting (e.g., `language`), **When** I use the `settings` skill to update it, **Then** the corresponding `settings.json` (or `settings.local.json`) should be updated correctly.

---

### User Story 2 - Guidance on Writing settings.json (Priority: P2)

As a user, I want the `settings` skill to provide guidance and documentation on how to write `settings.json`, including available fields and their meanings.

**Why this priority**: Improves user experience and discoverability of configuration options.

**Independent Test**: Can be tested by invoking the `settings` skill with a help or guide command and verifying the output contains useful information.

**Acceptance Scenarios**:

1. **Given** I am unsure how to configure a specific field, **When** I ask the `settings` skill for guidance, **Then** it should provide a clear explanation and examples.

---

### User Story 3 - Documentation for Complex Hooks (Priority: P3)

As a user, I want detailed documentation for complex hook configurations to be available in a separate file, linked from the main skill documentation, so I can understand how to use advanced features without cluttering the main guide.

**Why this priority**: Advanced users need this information, but it's better kept separate for clarity.

**Independent Test**: Verify that a separate markdown file exists for complex hooks and is linked from `SKILL.md`.

**Acceptance Scenarios**:

1. **Given** I want to configure a complex hook, **When** I read the `SKILL.md` for the settings skill, **Then** I should find a link to a detailed guide on hook configuration.

---

### Edge Cases

- What happens when the `settings.json` file is corrupted or contains invalid JSON?
- How does the system handle conflicts when the same setting is defined in multiple scopes?
- What happens if the user tries to set an invalid value for a setting (e.g., an invalid `permissionMode`)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a builtin `settings` skill.
- **FR-002**: The `settings` skill MUST be able to read and display merged configurations from user, project, and local scopes.
- **FR-003**: The `settings` skill MUST allow users to update settings in specific scopes (user, project, or local).
- **FR-004**: The `settings` skill MUST provide a guide on how to configure Wave, covering all supported fields in `settings.json` (`hooks`, `env`, `permissions`, `enabledPlugins`, `language`, `autoMemoryEnabled`, `autoMemoryFrequency`, `models`) and other configuration files (`.mcp.json` for MCP servers, `.wave/rules/` for memory rules, `.wave/skills/` for custom skills, and `.wave/agents/` for subagents).
- **FR-005**: System MUST include a `SKILL.md` for the `settings` skill.
- **FR-006**: System MUST create separate markdown files (e.g., `HOOKS.md`, `ENV.md`, `MCP.md`, `MEMORY_RULES.md`, `SKILLS.md`, `SUBAGENTS.md`, `MODELS.md`) for complex configurations and link them from `SKILL.md`.
- **FR-008**: The `settings` skill MUST provide guidance on how to create and manage custom skills and subagents.
- **FR-007**: The `settings` skill MUST validate the configuration before saving changes.

### Key Entities *(include if feature involves data)*

- **WaveConfiguration**: The root object representing all settings.
- **Scope**: Defines where the setting is stored (`user`, `project`, or `local`).
- **HookEvent**: The event that triggers a hook (e.g., `on_tool_call`).
- **PermissionRule**: A string defining an allowed or denied action.

### Assumptions

- The `settings` skill will be implemented as a builtin skill.
- The skill will use the existing `ConfigurationService` for reading and writing settings.
- "Complex hooks config" refers to advanced usage of the `hooks` field in `settings.json`.
