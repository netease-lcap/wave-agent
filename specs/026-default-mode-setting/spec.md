# Feature Specification: Default Permission Mode Setting

**Feature Branch**: `026-default-mode-setting`  
**Created**: 2025-12-09  
**Status**: Draft  
**Input**: User description: "if some users do not like write --dangerously-skip-permissions, they can modify settings.json(local proj user level) to set "defaultMode", it's value can be "default" or "bypassPermissions" too."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Default Permission Mode (Priority: P1)

A developer who frequently needs to bypass permissions for their development workflow wants to avoid typing `--dangerously-skip-permissions` every time. They want to set a persistent configuration that makes bypassing permissions the default behavior for their project.

**Why this priority**: This is the core functionality - allowing users to set a default permission mode without command-line flags. It provides the primary value proposition of the feature.

**Independent Test**: Can be fully tested by modifying settings.json with a defaultMode value and verifying that subsequent agent runs respect this setting without requiring command-line flags.

**Acceptance Scenarios**:

1. **Given** a project with no defaultMode setting, **When** user runs agent commands, **Then** default permission mode behavior applies (requires confirmation for restricted tools)
2. **Given** settings.json contains `"permissions": {"defaultMode": "bypassPermissions"}`, **When** user runs agent commands, **Then** permissions are bypassed without prompting
3. **Given** settings.json contains `"permissions": {"defaultMode": "default"}`, **When** user runs agent commands, **Then** user is prompted for confirmation on restricted tools
4. **Given** settings.json contains an invalid defaultMode value, **When** agent starts, **Then** system falls back to default permission behavior and logs a warning

---

### User Story 2 - Command-Line Override (Priority: P2)

A developer with a default permission mode configured still wants the ability to override this setting for specific runs using command-line flags.

**Why this priority**: Flexibility is important - users should be able to override their persistent settings when needed for specific situations.

**Independent Test**: Can be tested by setting a defaultMode in settings.json and verifying that `--dangerously-skip-permissions` or other permission flags override the configured default.

**Acceptance Scenarios**:

1. **Given** settings.json has `"permissions": {"defaultMode": "default"}`, **When** user runs with `--dangerously-skip-permissions`, **Then** permissions are bypassed for that run only
2. **Given** settings.json has `"permissions": {"defaultMode": "bypassPermissions"}`, **When** user runs without any permission flags, **Then** permissions are bypassed as configured

---

### User Story 3 - Configuration Validation and Feedback (Priority: P3)

A developer setting up the defaultMode configuration wants clear feedback when they've made configuration errors and guidance on correct values.

**Why this priority**: User experience enhancement - prevents confusion and ensures proper configuration setup.

**Independent Test**: Can be tested by providing invalid configuration values and verifying appropriate error messages and fallback behavior.

**Acceptance Scenarios**:

1. **Given** settings.json contains `"permissions": {"defaultMode": "invalid"}`, **When** agent loads configuration, **Then** system logs a clear error message explaining valid values and falls back to default behavior
2. **Given** settings.json has malformed JSON, **When** agent loads configuration, **Then** system handles the error gracefully and uses default permission behavior

---

### Edge Cases

- What happens when settings.json and settings.local.json contain different defaultMode values at the project level?
- How does the system handle concurrent access to settings.json during configuration changes?
- What occurs when settings.json is deleted or becomes unreadable after initial configuration?
- How are permission prompts handled when running in non-interactive environments with defaultMode set to "default"?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a `defaultMode` setting in `permissions` object in settings.json with values "default" or "bypassPermissions"
- **FR-002**: System MUST apply the configured defaultMode as the default permission behavior when no command-line permission flags are provided
- **FR-003**: Command-line permission flags MUST override any configured defaultMode setting for that specific execution
- **FR-004**: System MUST validate defaultMode values and fall back to standard default behavior for invalid configurations
- **FR-005**: System MUST provide clear error messages when invalid defaultMode values are encountered
- **FR-006**: Configuration changes to defaultMode MUST take effect on the next agent execution without requiring application restart
- **FR-007**: System MUST handle missing or malformed settings.json files gracefully, falling back to default permission behavior
- **FR-008**: The defaultMode setting MUST work at user-level, project-level, and local project settings files (settings.json and settings.local.json), with project-level settings taking precedence over user-level settings
- **FR-009**: Settings precedence MUST follow the hierarchy: settings.local.json > settings.json (project-level) > settings.json (user-level)

### Key Entities

- **DefaultMode Setting**: A configuration value in `permissions` object in settings.json that specifies the default permission behavior, accepting values "default" or "bypassPermissions"
- **Settings Configuration**: The existing settings.json and settings.local.json configuration structure that will be extended to include the defaultMode property
- **Permission Context**: The runtime context that determines whether to use configured defaults or command-line overrides for permission handling

## Assumptions

- The existing ConfigurationWatcher service will handle live reloading of the defaultMode setting
- The current PermissionManager architecture supports dynamic permission mode configuration
- Users are familiar with editing JSON configuration files
- The existing settings.json validation framework can be extended to include defaultMode validation for both settings.json and settings.local.json files
- Settings precedence follows: settings.local.json > project settings.json > user-level settings.json