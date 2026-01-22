# Feature Specification: Local Plugin Marketplace

**Feature Branch**: `044-local-plugin-marketplace`  
**Created**: 2026-01-13  
**Status**: Implemented  
**Input**: User description: "support local marketplace: Create the directory structure... wave plugin marketplace add ./my-marketplace... wave plugin install review-plugin@my-plugins"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Add Local Marketplace (Priority: P1)

As a developer, I want to create a local directory structure that acts as a plugin marketplace so that I can organize and share my custom plugins locally.

**Why this priority**: This is the core functionality that enables the entire local marketplace feature. Without being able to define and add a marketplace, no other features can work.

**Independent Test**: Can be tested by creating the required directory structure and `marketplace.json`, then running `wave plugin marketplace add [path]` and verifying it appears in the list of marketplaces.

**Acceptance Scenarios**:

1. **Given** a directory with a valid `marketplace.json` in `.wave-plugin/`, **When** I run `wave plugin marketplace add [path]`, **Then** the marketplace is successfully registered in the system.
2. **Given** a registered local marketplace, **When** I list available marketplaces, **Then** I should see my local marketplace in the list.

---

### User Story 2 - Install Plugin from Local Marketplace (Priority: P1)

As a user, I want to install a plugin from a registered local marketplace so that I can use its commands in my workflow.

**Why this priority**: Installing plugins is the primary way users interact with the marketplace.

**Independent Test**: Can be tested by running `wave plugin install [plugin-name]@[marketplace-name]` and verifying the plugin is marked as installed.

**Acceptance Scenarios**:

1. **Given** a registered local marketplace containing a plugin, **When** I run `wave plugin install [plugin-name]@[marketplace-name]`, **Then** the plugin is installed and its commands become available with the plugin name as a prefix (e.g., `/review-plugin:review`).
2. **Given** an attempt to install a non-existent plugin, **When** I run the install command, **Then** I should receive a clear error message.

---

### Edge Cases

- **What happens when the marketplace path is invalid?** The system should return an error indicating the path does not exist or does not contain a valid `marketplace.json`.
- **How does the system handle duplicate plugin names across different marketplaces?** Users MUST specify the marketplace using the `@` syntax (e.g., `install review-plugin@my-plugins`) to avoid ambiguity.
- **What happens if a plugin's source path in `marketplace.json` is invalid?** The installation should fail with a descriptive error.

## Assumptions

- The `wave` CLI is the primary interface for managing marketplaces and plugins.
- Local marketplaces are stored on the same filesystem as the `wave` installation.
- Plugin commands are intended to be executed within the context of an editor or terminal where `wave` is active.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support adding a local directory as a plugin marketplace via `wave plugin marketplace add [path]`.
- **FR-002**: System MUST recognize a marketplace catalog file named `marketplace.json` located in a `.wave-plugin/` subdirectory of the marketplace root.
- **FR-003**: System MUST support installing a plugin using the syntax `[plugin-name]@[marketplace-name]`.
- **FR-004**: System MUST recognize plugin manifests named `plugin.json` located in a `.wave-plugin/` subdirectory of each plugin's directory (as defined in `042-local-plugin-support`).
- **FR-005**: System MUST support relative paths for plugin sources within the `marketplace.json` file.
- **FR-006**: System MUST copy plugin files from the local source to a central installation directory during installation to ensure a stable snapshot of the plugin.
- **FR-007**: System MUST allow updating an installed plugin by re-running the `wave plugin install [plugin-name]@[marketplace-name]` command.
- **FR-009**: System MUST list all available plugins from all registered marketplaces via `wave plugin list`, indicating their installation and enabled status.

### Key Entities *(include if feature involves data)*

- **Marketplace**: A collection of plugins, defined by a `marketplace.json` file containing the marketplace name, owner, and a list of plugins with their source paths.
- **Plugin**: A functional unit containing metadata (`plugin.json`) and one or more commands.
- **Command**: A specific action defined in a Markdown file that describes the command's behavior and prompt.
