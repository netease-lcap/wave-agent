# Feature Specification: Live Configuration Reload

**Feature Branch**: `019-live-config-reload`  
**Created**: 2024-12-01  
**Status**: Implemented  
**Input**: User description: "1, settings.json should support env field, so that we can pass env vars to wave code and wave agent sdk. 2, settings.json should support living reload, when user modify them, they should take effect immediately without restarting cli or sdk."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Custom Environment Variables (Priority: P1)

A developer needs to pass custom environment variables (API keys, database URLs, feature flags) to their Wave Agent SDK without hardcoding them in their code. They add an "env" field to their settings.json file and expect these variables to be available in their agent execution context. The Wave Code CLI will inherit this functionality since it uses the SDK.

**Why this priority**: This provides essential configuration flexibility and follows security best practices by keeping sensitive data in configuration files rather than code.

**Independent Test**: Can be fully tested by adding env variables to settings.json and verifying they are accessible in agent processes, delivering immediate configuration value.

**Acceptance Scenarios**:

1. **Given** a settings.json file with env field containing key-value pairs, **When** Wave Agent SDK is started, **Then** those environment variables are available to all agent processes
2. **Given** both user-level and project-level settings.json files with env fields, **When** an agent runs, **Then** project-level env variables override user-level ones with the same name
3. **Given** an env field with invalid format, **When** settings are loaded, **Then** system shows clear error message about invalid environment variable configuration

---

### User Story 2 - Live Settings Reload (Priority: P2)

A developer is actively working and needs to modify their settings.json configuration (hooks, environment variables, etc.). They want these changes to take effect immediately without restarting the SDK, enabling rapid iteration on their configuration. The Wave Code CLI will benefit from this since it uses the SDK.

**Why this priority**: Eliminates workflow disruption and improves developer productivity by removing restart requirements for configuration changes.

**Independent Test**: Can be tested by modifying settings.json while CLI/SDK is running and verifying new configuration takes effect on next operation.

**Acceptance Scenarios**:

1. **Given** Wave Agent SDK is running, **When** user modifies settings.json, **Then** changes are detected and applied to subsequent operations without restart
2. **Given** Wave Agent SDK is processing requests, **When** settings.json is updated, **Then** new settings are used for the next agent execution
3. **Given** invalid settings are saved, **When** file watcher detects changes, **Then** system logs error but continues with previous valid configuration

---

### Edge Cases

- What happens when settings.json contains malformed JSON during live reload?
- How does system handle file system permission errors during file watching?
- How does system handle rapid consecutive file modifications?
- What happens when file watchers fail to initialize on system startup?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: settings.json MUST support an optional "env" field containing key-value pairs of environment variables
- **FR-002**: System MUST merge user-level and project-level env configurations, with project-level taking precedence
- **FR-003**: System MUST validate env field format and show clear errors for invalid configurations
- **FR-004**: System MUST watch settings.json files for changes and reload configuration automatically
- **FR-005**: System MUST continue operating with previous valid configuration when invalid changes are detected
- **FR-006**: System MUST log configuration reload events and errors appropriately
- **FR-007**: File watchers MUST handle file deletion, creation, and modification events
- **FR-008**: Environment variables from env field MUST be available to hook processes and agent execution context
- **FR-009**: System MUST handle file watcher initialization failures by throwing descriptive error and preventing SDK startup

### Key Entities

- **Settings Configuration**: Contains hooks, env variables, and other configuration options, watched for changes
- **File Watcher**: Monitors configuration files and triggers reload events
- **Environment Context**: Merged environment variables from user and project settings, passed to agent processes
