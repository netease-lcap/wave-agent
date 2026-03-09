# Feature Specification: Plugin Support

**Feature Branch**: `042-plugin-support`
**Status**: Unified Specification

## Context
This specification merges and unifies the requirements for local plugin support, expanded plugin capabilities (Skills, LSP, MCP, Hooks, Agents), and plugin scope management. It provides a single source of truth for how plugins are structured, loaded, and managed within the Wave ecosystem.

## User Scenarios & Testing

### User Story 1 - Developer creates a local plugin (Priority: P1)
As a developer, I want to create a custom plugin locally so that I can extend the agent's capabilities with my own commands, skills, and other components.

**Acceptance Scenarios**:
1. **Given** a new directory `my-plugin`, **When** I create `.wave-plugin/plugin.json` with valid metadata, **Then** the directory is recognized as a valid plugin structure.
2. **Given** a plugin directory, **When** I add a Markdown file to the `commands/` directory, **Then** it is recognized as a potential slash command.
3. **Given** a plugin directory, **When** I add a `skills/my-skill/SKILL.md` file with valid frontmatter, **Then** the system recognizes the "my-skill" skill.

### User Story 2 - User loads and manages plugins (Priority: P1)
As a user, I want to load local plugins and manage their enabled state across different scopes (user, project, local).

**Acceptance Scenarios**:
1. **Given** a valid plugin at `./my-plugin`, **When** I run `wave --plugin-dir ./my-plugin`, **Then** the plugin is loaded into the session.
2. **Given** a plugin is installed, **When** I run `wave plugin enable <plugin-id> --scope project`, **Then** the plugin is enabled for the current project and its commands are available.
3. **Given** multiple scopes have conflicting settings for a plugin, **When** the system loads plugins, **Then** it MUST respect the priority: `local` > `project` > `user`.

### User Story 3 - Correct Plugin Structure Validation (Priority: P3)
As a developer, I want the system to warn me if I put component directories (like `skills/` or `commands/`) inside the `.wave-plugin/` directory.

**Acceptance Scenarios**:
1. **Given** a plugin where `skills/` is inside `.wave-plugin/`, **When** the plugin is loaded, **Then** the system should ignore the `skills/` directory or provide a warning.

## Requirements

### Functional Requirements
- **FR-001**: System MUST recognize `.wave-plugin/plugin.json` as the plugin manifest file.
- **FR-002**: Plugin manifest MUST include `name`, `description`, and `version`.
- **FR-003**: System MUST support the following component directories at the plugin root:
    - `commands/`: Slash commands as Markdown files.
    - `skills/`: Agent Skills with `SKILL.md` files.
    - `agents/`: Custom agent definitions.
    - `hooks/`: Event handlers in `hooks.json`.
- **FR-004**: System MUST support the following configuration files at the plugin root:
    - `.lsp.json`: LSP server configurations.
    - `.mcp.json`: MCP server configurations.
- **FR-005**: System MUST enforce that only `plugin.json` is located inside the `.wave-plugin/` directory.
- **FR-006**: Slash commands MUST be namespaced using the plugin name and a colon (e.g., `/plugin-name:command-name`).
- **FR-007**: System MUST support three installation scopes: `user` (global), `project` (shared via repo), and `local` (user-specific to repo).
- **FR-008**: Plugin loading logic MUST aggregate `enabledPlugins` from all applicable scopes and apply them in priority order: `local` > `project` > `user`.
- **FR-009**: `wave plugin install` MUST automatically add the plugin to `enabledPlugins` in the specified scope.
- **FR-010**: System MUST support a `--plugin-dir` flag to load a plugin from a specific directory.

### Key Entities
- **Plugin**: A self-contained directory containing metadata and functionality extensions.
- **Plugin Manifest**: A JSON file (`.wave-plugin/plugin.json`) containing the plugin's identity and metadata.
- **Skill**: A model-invoked capability defined by a `SKILL.md` file.
- **Scope**: A configuration level (user, project, or local) that determines where settings are stored and their precedence.

## Assumptions
- **A-001**: Installed plugins are **DISABLED** by default if they are not explicitly mentioned in any `enabledPlugins` configuration.
- **A-002**: The `enabledPlugins` setting in `settings.json` takes precedence over the mere presence of the plugin in the cache.
- **A-003**: Users MUST use the `name@marketplace` format to uniquely identify plugins for scope management.
