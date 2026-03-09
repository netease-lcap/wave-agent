# Feature Specification: Plugin Marketplace and Management UI

**Feature Branch**: `044-plugin-marketplace`
**Status**: Unified Specification

## Context
This specification merges and unifies the requirements for the entire Wave plugin ecosystem, including local, GitHub, and builtin marketplace support, as well as the interactive CLI management interface. It provides a single source of truth for how plugins are discovered, installed, and managed.

## User Scenarios & Testing

### User Story 1 - Discover and Install Plugins (Priority: P1)
As a user, I want to browse available plugins from marketplaces and install them in different scopes so that I can extend the functionality of Wave for myself or my team.

**Acceptance Scenarios**:
1. **Given** the user is in the "Discover" section of the `wave plugin` UI, **When** they select a plugin, **Then** they should see details and three installation options: Project (default), User, and Local.
2. **Given** a plugin is selected, **When** "Install for all collaborators (project scope)" is chosen, **Then** the plugin is downloaded and automatically enabled in the repository configuration.
3. **Given** a plugin is selected, **When** "Install for you (user scope)" is chosen, **Then** the plugin is downloaded and automatically enabled globally for the current user.
4. **Given** a plugin is selected, **When** "Install for you, in this repo only (local scope)" is chosen, **Then** the plugin is downloaded and automatically enabled for the user but only active in the current repository.
5. **Given** a new installation of Wave, **When** I run `wave plugin marketplace list`, **Then** I should see `wave-plugins-official` in the list of registered marketplaces.

### User Story 2 - Manage Installed Plugins (Priority: P2)
As a user, I want to see which plugins I have installed and be able to toggle their status or remove them to keep my environment clean and functional.

**Acceptance Scenarios**:
1. **Given** the user is in the "Installed" section, **When** they select a plugin, **Then** they should see the option to Uninstall, Enable, or Disable.
2. **Given** a plugin, **When** "Uninstall" is selected, **Then** the plugin is removed from the current scope's configuration. Physical files are deleted if no other projects reference them.

### User Story 3 - Manage Marketplaces (Priority: P3)
As a user, I want to add and manage marketplace sources so that I can access plugins from various providers (GitHub, SSH, or local paths).

**Acceptance Scenarios**:
1. **Given** a valid GitHub repository `owner/repo`, **When** I run `wave plugin marketplace add owner/repo`, **Then** the marketplace is successfully registered.
2. **Given** a valid Git repository URL, **When** I run `wave plugin marketplace add [url]`, **Then** the marketplace is successfully registered.
3. **Given** a directory with a valid `marketplace.json`, **When** I run `wave plugin marketplace add [path]`, **Then** the marketplace is successfully registered.
4. **Given** an existing marketplace, **When** selected in the UI, **Then** the user can choose to "Update" (refresh plugin list) or "Remove" the marketplace.

## Requirements

### Functional Requirements
- **FR-001**: System MUST provide a standalone Ink-based CLI interface triggered by `wave plugin`.
- **FR-002**: System MUST support three main navigation areas: Discover, Installed, and Marketplaces.
- **FR-003**: System MUST support three installation scopes: User (global), Project (shared via repo), and Local (user-specific to repo).
- **FR-004**: System MUST allow adding marketplaces via GitHub shorthand (`owner/repo`), Git URLs (with fragments for refs), and local filesystem paths.
- **FR-005**: System MUST include `wave-plugins-official` (netease-lcap/wave-plugins-official on github) as a default registered marketplace.
- **FR-006**: System MUST support plugin sources defined as relative paths in `marketplace.json`.
- **FR-007**: System MUST cache marketplace manifests locally to avoid redundant network requests.
- **FR-008**: System MUST support updating marketplaces via `wave plugin marketplace update [name]` or the UI.
- **FR-009**: System MUST support auto-update for registered marketplaces (enabled by default for builtin).
- **FR-010**: System MUST check for Git availability before performing any GitHub or Git-related operations.

### Key Entities
- **Plugin**: Represents an extension for Wave. Attributes include name, description, version, and source marketplace.
- **Marketplace**: A source of plugins. Attributes include name, source URL/path, and a list of available plugins.
- **Installation**: Represents the state of a plugin on the user's system. Attributes include scope (User/Project/Local) and status (Enabled/Disabled).

## Assumptions
- **A-001**: The underlying plugin installation logic is handled by SDK services.
- **A-002**: "Project scope" installation involves modifying a file typically committed to version control (e.g., `.wave/config.json`).
- **A-003**: The system should have `git` installed to use GitHub or Git-based marketplaces.
- **A-004**: Local marketplaces are stored on the same filesystem as the `wave` installation.
