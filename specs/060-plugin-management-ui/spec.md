# Feature Specification: Plugin Management UI

**Feature Branch**: `060-plugin-management-ui`  
**Created**: 2026-02-04  
**Status**: Draft  
**Input**: User description: "when user run `wave plugin`, system should render a standalone ink component like packages/code/src/session-selector-cli.tsx . to show : 1 discover plugin list, select item, goto detail and show Install for you (user scope), Install for all collaborators on this repository (project scope), Install for you, in this repo only (local scope). 2, Installed plugin list, select item goto detail page, enable or disable or uninstall. 3, Marketplaces list, select add marketplace, goto add page, Enter marketplace source: Examples: owner/repo (GitHub), git@github.com:owner/repo.git (SSH), ./path/to/marketplace. select item, goto detail page, update and remove."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover and Install Plugins (Priority: P1)

As a user, I want to browse available plugins from marketplaces and install them in different scopes so that I can extend the functionality of Wave for myself or my team.

**Why this priority**: This is the core value proposition—getting new functionality into the system.

**Independent Test**: Can be tested by running `wave plugin`, navigating to "Discover", selecting a plugin, and choosing an installation scope.

**Acceptance Scenarios**:

1. **Given** the user is in the "Discover" section, **When** they select a plugin, **Then** they should see details and three installation options: Project (default), User, and Local. They can navigate these options using Up/Down arrows and press Enter to install.
2. **Given** a plugin is selected, **When** "Install for all collaborators (project scope)" is chosen (default), **Then** the plugin is downloaded and automatically enabled in the repository configuration.
3. **Given** a plugin is selected, **When** "Install for you (user scope)" is chosen, **Then** the plugin is downloaded and automatically enabled globally for the current user.
4. **Given** a plugin is selected, **When** "Install for you, in this repo only (local scope)" is chosen, **Then** the plugin is downloaded and automatically enabled for the user but only active in the current repository.

---

### User Story 2 - Manage Installed Plugins (Priority: P2)

As a user, I want to see which plugins I have installed and be able to toggle their status or remove them to keep my environment clean and functional.

**Why this priority**: Essential for maintaining the system after initial installation.

**Independent Test**: Can be tested by navigating to "Installed", selecting a plugin, and performing enable/disable/uninstall actions.

**Acceptance Scenarios**:

  1. **Given** the user is in the "Installed" section, **When** they select a plugin, **Then** they should see the option to Uninstall.
  2. **Given** a plugin, **When** "Uninstall" is selected, **Then** the plugin is removed from the current scope's configuration, and its reference is removed from the global registry. The physical files remain in the global cache if other projects still reference them, but are deleted if no references remain.

---

### User Story 3 - Manage Marketplaces (Priority: P3)

As a user, I want to add and manage marketplace sources so that I can access plugins from various providers (GitHub, SSH, or local paths).

**Why this priority**: Enables the ecosystem to grow beyond default sources.

**Independent Test**: Can be tested by navigating to "Marketplaces", adding a new source, and verifying it appears in the list.

**Acceptance Scenarios**:

1. **Given** the user is in the "Marketplaces" section, **When** they select "Add Marketplace", **Then** they are prompted to enter a source (GitHub repo, SSH URL, or local path).
2. **Given** an existing marketplace, **When** selected, **Then** the user can choose to "Update" (refresh plugin list) or "Remove" the marketplace.

---

### Edge Cases

- **What happens when a marketplace source is invalid?** The system should display a clear error message and allow the user to correct the input.
- **How does the system handle network failures during plugin discovery?** It should show a "Retry" option or an offline state message.
- **What happens if a plugin is already installed in a different scope?** The UI should indicate the current installation status and allow changing scopes or upgrading.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a standalone Ink-based CLI interface triggered by `wave plugin`.
- **FR-002**: System MUST support three main navigation areas: Discover, Installed, and Marketplaces. Navigation between these areas MUST be supported via `Tab` and `Shift+Tab` keys.
- **FR-003**: System MUST support three installation scopes: User (global), Project (shared via repo), and Local (user-specific to repo).
- **FR-004**: System MUST allow adding marketplaces via GitHub shorthand (`owner/repo`), SSH URLs, and local filesystem paths.
- **FR-005**: System MUST persist marketplace configurations and plugin installation states.
- **FR-006**: System MUST provide visual feedback for plugin status (Installing/Installed).
- **FR-007**: System MUST allow updating marketplace metadata to discover new or updated plugins.
- **FR-008**: System MUST allow users to remove a marketplace from their configuration.
- **FR-009**: System MUST support a "Update" action for installed plugins, which performs a re-installation.
- **FR-010**: The "Installed" view MUST only show plugins that are enabled in the current scope.
- **FR-011**: The "Discover" view MUST include plugins that are installed but not enabled in the current scope.
- **FR-012**: Actions for installed plugins (Uninstall, Update) MUST be presented as a selection menu rather than individual keybindings.
- **FR-013**: Uninstallation MUST use reference counting via `projectPath` to determine if physical cache files should be deleted.

### Key Entities *(include if feature involves data)*

- **Plugin**: Represents an extension for Wave. Attributes include name, description, version, and source marketplace.
- **Marketplace**: A source of plugins. Attributes include name, source URL/path, and a list of available plugins.
- **Installation**: Represents the state of a plugin on the user's system. Attributes include scope (User/Project/Local) and status (Enabled/Disabled).

## Assumptions

- **A-001**: The underlying plugin installation logic (downloading, file placement) is handled by existing SDK services; this feature focuses on the UI and orchestration.
- **A-002**: "Project scope" installation involves modifying a file that is typically committed to version control (e.g., `.wave/config.json`).
- **A-003**: The "Discover" list aggregates plugins from all configured marketplaces that are NOT currently installed.
