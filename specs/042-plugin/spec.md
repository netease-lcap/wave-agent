# Feature Specification: Plugin Support and Marketplace

**Feature Branch**: `042-plugin`

## Context
This specification merges and unifies the requirements for local plugin support, expanded plugin capabilities (Skills, LSP, MCP, Hooks, Agents), plugin scope management, and the plugin marketplace ecosystem (including local, GitHub, and builtin marketplace support, as well as the interactive CLI management interface). It provides a single source of truth for how plugins are discovered, installed, and managed within the Wave ecosystem.

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

### User Story 4 - Discover and Install Plugins (Priority: P1)
As a user, I want to browse available plugins from marketplaces and install them in different scopes so that I can extend the functionality of Wave for myself or my team.

**Acceptance Scenarios**:
1. **Given** the user is in the "Discover" section of the `wave plugin` UI, **When** they select a plugin, **Then** they should see details and three installation options: Project (default), User, and Local.
2. **Given** a plugin is selected, **When** "Install for all collaborators (project scope)" is chosen, **Then** the plugin is downloaded and automatically enabled in the repository configuration.
3. **Given** a plugin is selected, **When** "Install for you (user scope)" is chosen, **Then** the plugin is downloaded and automatically enabled globally for the current user.
4. **Given** a plugin is selected, **When** "Install for you, in this repo only (local scope)" is chosen, **Then** the plugin is downloaded and automatically enabled for the user but only active in the current repository.
5. **Given** a new installation of Wave, **When** I run `wave plugin marketplace list`, **Then** I should see `wave-plugins-official` in the list of registered marketplaces.

### User Story 5 - Manage Installed Plugins (Priority: P2)
As a user, I want to see which plugins I have installed and be able to toggle their status or remove them to keep my environment clean and functional.

**Acceptance Scenarios**:
1. **Given** the user is in the "Installed" section, **When** they select a plugin, **Then** they should see the option to Uninstall, Enable, or Disable.
2. **Given** a plugin, **When** "Uninstall" is selected, **Then** the plugin is removed from the current scope's configuration. Physical files are deleted if no other projects reference them.

### User Story 6 - Manage Marketplaces (Priority: P3)
As a user, I want to add and manage marketplace sources so that I can access plugins from various providers (GitHub, SSH, or local paths).

**Acceptance Scenarios**:
1. **Given** a valid GitHub repository `owner/repo`, **When** I run `wave plugin marketplace add owner/repo`, **Then** the marketplace is successfully registered.
2. **Given** a valid Git repository URL, **When** I run `wave plugin marketplace add [url]`, **Then** the marketplace is successfully registered.
3. **Given** a directory with a valid `marketplace.json`, **When** I run `wave plugin marketplace add [path]`, **Then** the marketplace is successfully registered.
4. **Given** an existing marketplace, **When** selected in the UI, **Then** the user can choose to "Update" (refresh plugin list) or "Remove" the marketplace.

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
- **FR-007**: Agent Skills provided by plugins MUST be namespaced using the plugin name and a colon (e.g., `/plugin-name:skill-name`).
- **FR-008**: System MUST support three installation scopes: `user` (global), `project` (shared via repo), and `local` (user-specific to repo).
- **FR-009**: Plugin loading logic MUST aggregate `enabledPlugins` from all applicable scopes and apply them in priority order: `local` > `project` > `user`.
- **FR-010**: `wave plugin install` MUST automatically add the plugin to `enabledPlugins` in the specified scope.
- **FR-011**: System MUST support a `--plugin-dir` flag to load a plugin from a specific directory.
- **FR-012**: System MUST provide a standalone Ink-based CLI interface triggered by `wave plugin`.
- **FR-013**: System MUST support three main navigation areas: Discover, Installed, and Marketplaces.
- **FR-014**: System MUST allow adding marketplaces via GitHub shorthand (`owner/repo`), Git URLs (with fragments for refs), and local filesystem paths.
- **FR-015**: System MUST include `wave-plugins-official` (netease-lcap/wave-plugins-official on github) as a default registered marketplace.
- **FR-016**: System MUST support plugin sources defined as relative paths in `marketplace.json`.
- **FR-017**: System MUST cache marketplace manifests locally to avoid redundant network requests.
- **FR-018**: System MUST support updating marketplaces via `wave plugin marketplace update [name]` or the UI.
- **FR-019**: System MUST support auto-update for registered marketplaces (enabled by default for builtin).
- **FR-020**: System MUST check for Git availability before performing any GitHub or Git-related operations.
- **FR-021**: System MUST track and display the last update time for each registered marketplace.
- **FR-022**: System MUST perform marketplace auto-updates in the background during startup to avoid blocking the CLI.
- **FR-023**: System MUST implement a file-based locking mechanism to ensure safe concurrent access to plugin registries and cache.
- **FR-024**: System MUST enforce a timeout (default 120s) for all Git operations to prevent hanging on slow networks or large repositories.

### Key Entities
- **Plugin**: A self-contained directory containing metadata and functionality extensions.
- **Plugin Manifest**: A JSON file (`.wave-plugin/plugin.json`) containing the plugin's identity and metadata.
- **Skill**: A model-invoked capability defined by a `SKILL.md` file.
- **Scope**: A configuration level (user, project, or local) that determines where settings are stored and their precedence.
- **Marketplace**: A source of plugins. Attributes include name, source URL/path, and a list of available plugins.
- **Installation**: Represents the state of a plugin on the user's system. Attributes include scope (User/Project/Local) and status (Enabled/Disabled).

## Assumptions
- **A-001**: Installed plugins are **DISABLED** by default if they are not explicitly mentioned in any `enabledPlugins` configuration.
- **A-002**: The `enabledPlugins` setting in `settings.json` takes precedence over the mere presence of the plugin in the cache.
- **A-003**: Users MUST use the `name@marketplace` format to uniquely identify plugins for scope management.
- **A-004**: The underlying plugin installation logic is handled by SDK services.
- **A-005**: "Project scope" installation involves modifying a file typically committed to version control (e.g., `.wave/config.json`).
- **A-006**: The system should have `git` installed to use GitHub or Git-based marketplaces.
- **A-007**: Local marketplaces are stored on the same filesystem as the `wave` installation.
