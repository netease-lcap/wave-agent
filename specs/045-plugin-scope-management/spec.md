# Feature Specification: Plugin Scope Management

**Feature Branch**: `045-plugin-scope-management`  
**Created**: 2026-01-13  
**Status**: Draft  
**Input**: User description: "wave plugin should support disable enable, and each should support  -s, --scope <scope>  Installation scope: user, project, or local (default: \"user\"). plus, plugin install should support -s --scope too. after install, related settings.json should be added like :   \"enabledPlugins\": { \"review-plugin@my-plugins\": true }. refer to specs/044-local-plugin-marketplace to learn current spec"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Contextual Plugin Control (Priority: P1)

As a developer working on multiple projects, I want to enable certain plugins globally for my user account but disable them or enable different ones for specific projects or directories.

**Why this priority**: This is the core requirement. It allows users to manage their toolset based on the context of their work, preventing command clutter and ensuring project-specific tools are available where needed.

**Independent Test**: Can be tested by installing a plugin, then using `wave plugin disable <plugin> -s project` in a specific directory and verifying that the plugin's commands are not available in that directory but remain available elsewhere.

**Acceptance Scenarios**:

1. **Given** a plugin is installed globally, **When** I run `wave plugin disable <plugin> -s project` in a project directory, **Then** the plugin is disabled for that project and its commands are no longer available there.
2. **Given** a plugin is disabled globally, **When** I run `wave plugin enable <plugin> -s local` in the current directory, **Then** the plugin is enabled only for the current directory.
3. **Given** multiple scopes have conflicting settings for a plugin, **When** the system loads plugins, **Then** it MUST respect the priority: `local` > `project` > `user`.

---

### User Story 2 - Scoped Plugin Installation (Priority: P1)

As a user, I want to install a plugin and have it automatically enabled at a specific scope so that I don't have to run a separate enable command.

**Why this priority**: This improves the user experience by combining installation and activation into a single step with clear scope control.

**Independent Test**: Can be tested by running `wave plugin install <plugin>@<marketplace> -s project` and verifying that the plugin is installed and the project's `settings.json` is updated with `"enabledPlugins": { "<plugin>@<marketplace>": true }`.

**Acceptance Scenarios**:

1. **Given** a registered marketplace, **When** I run `wave plugin install <plugin>@<marketplace> -s user`, **Then** the plugin is installed and enabled in the user-level `settings.json`.
2. **Given** a registered marketplace, **When** I run `wave plugin install <plugin>@<marketplace>` (without scope), **Then** it defaults to the `user` scope.

---

### Edge Cases

- **Missing .wave directory**: If a command is run for a scope where the `.wave` directory does not exist, the system should create it (except possibly for `user` scope which should already exist).
- **Invalid settings.json**: If the `settings.json` file exists but contains invalid JSON, the system should report an error and not overwrite the file with a "fixed" but potentially data-losing version.
- **Plugin not installed**: If a user tries to enable/disable a plugin that is not installed, the system should provide a clear error message.
- **Ambiguous plugin names**: Users MUST use the `name@marketplace` format to uniquely identify plugins.

## Assumptions

- Installed plugins are **ENABLED** by default if they are not explicitly mentioned in any `enabledPlugins` configuration.
- The `enabledPlugins` setting in `settings.json` takes precedence over the mere presence of the plugin in the cache.
- `settings.json` is the primary location for these settings, following the pattern of other Wave configurations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support `wave plugin enable <plugin-id>` command.
- **FR-002**: System MUST support `wave plugin disable <plugin-id>` command.
- **FR-003**: `enable`, `disable`, and `install` commands MUST support `-s, --scope <scope>` option.
- **FR-004**: Supported scopes MUST be `user`, `project`, and `local`.
- **FR-005**: Default scope for all commands MUST be `user`.
- **FR-006**: `user` scope MUST refer to `~/.wave/settings.json`.
- **FR-007**: `project` scope MUST refer to `.wave/settings.json` in the current project directory.
- **FR-008**: `local` scope MUST refer to `.wave/settings.local.json` in the current project directory.
- **FR-009**: Enabling a plugin MUST set its value to `true` in the `enabledPlugins` object of the target `settings.json`.
- **FR-010**: Disabling a plugin MUST set its value to `false` in the `enabledPlugins` object of the target `settings.json`.
- **FR-011**: `wave plugin install` MUST automatically add the plugin to `enabledPlugins` with a value of `true` in the specified scope.
- **FR-012**: Plugin loading logic MUST aggregate `enabledPlugins` from all applicable scopes and apply them in priority order: `local` > `project` > `user`.
- **FR-013**: If a plugin is marked `false` in a higher-priority scope, it MUST be disabled even if marked `true` in a lower-priority scope.

### Key Entities *(include if feature involves data)*

- **Scope**: A configuration level (user, project, or local) that determines where settings are stored and their precedence.
- **EnabledPlugins**: A mapping in `settings.json` where keys are plugin IDs (`name@marketplace`) and values are booleans indicating the enabled state.
