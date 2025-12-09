# Feature Specification: Refactor Configuration Management

**Feature Branch**: `027-refactor-config-management`  
**Created**: 2025-12-09  
**Status**: Draft  
**Input**: User description: "1,config.env are already set to process.env, no need to pass to hook. 2, many settings.json related logic are in hook files, but it should be a more global scope, not just about hook, move to more proper files"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Environment Variable Management Cleanup (Priority: P1)

Developers working with the Wave Agent SDK currently have redundant configuration management where environment variables from `waveConfig.env` are both set to `process.env` and passed separately to hook execution. This creates confusion and potential inconsistencies.

**Why this priority**: This directly addresses the core issue of redundant configuration handling and improves code clarity and maintainability. It's the foundation for cleaner architecture.

**Independent Test**: Can be fully tested by verifying that hooks can access environment variables through `process.env` without requiring them to be passed as additional parameters, and that no configuration is duplicated or lost.

**Acceptance Scenarios**:

1. **Given** environment variables are defined in settings.json, **When** hooks are executed, **Then** they can access these variables through `process.env` without additional parameters
2. **Given** existing environment variables are already set, **When** Wave configuration loads, **Then** Wave configuration variables override existing process.env values
3. **Given** hook execution context is created, **When** no additional environment variables are passed, **Then** hooks still have access to all required configuration through `process.env`

---

### User Story 2 - Centralized Configuration Management (Priority: P2) 

Settings.json loading, validation, and management logic is currently scattered across hook-specific files (`hook.ts`, `hookManager.ts`) but represents general configuration functionality that should be available globally throughout the SDK.

**Why this priority**: This establishes proper separation of concerns and makes configuration management reusable across the entire SDK, not just for hooks.

**Independent Test**: Can be fully tested by verifying that configuration management functions are accessible from a central location and that hook-specific files only contain hook execution logic.

**Acceptance Scenarios**:

1. **Given** settings.json files exist, **When** any SDK component needs configuration, **Then** it can access centralized configuration management functions
2. **Given** configuration validation is required, **When** loading settings from any source, **Then** validation logic is available from the central configuration module
3. **Given** configuration merging is needed, **When** combining user and project settings, **Then** merging logic is available independently of hook functionality

---

### User Story 3 - Improved Code Organization (Priority: P3)

The configuration management code is better organized with clear responsibilities - core configuration services handle loading/validation/merging, while hook services focus only on hook execution.

**Why this priority**: This improves long-term maintainability and makes the codebase more intuitive for developers to understand and extend.

**Independent Test**: Can be tested by verifying that configuration-related functions are properly separated from hook execution concerns and that the module boundaries are clear.

**Acceptance Scenarios**:

1. **Given** a developer needs to understand configuration management, **When** they explore the codebase, **Then** configuration logic is found in appropriately named configuration modules
2. **Given** hook execution needs occur, **When** examining hook files, **Then** they contain only hook-specific execution logic
3. **Given** configuration changes are needed, **When** modifying configuration behavior, **Then** changes are made in centralized configuration modules

---

### User Story 4 - Simplified Configuration Loading (Priority: P2)

Developers and users currently experience complex fallback behavior when Wave configuration files contain invalid JSON or structure, making it difficult to understand which configuration is actually being used. The system should load configuration directly and provide clear feedback about what configuration is active.

**Why this priority**: This improves user experience by making configuration behavior transparent and predictable. Users should know immediately when their configuration is invalid rather than having the system silently fall back to previous configurations.

**Independent Test**: Can be fully tested by providing invalid configuration files and verifying that the system clearly reports the configuration status without silent fallbacks.

**Acceptance Scenarios**:

1. **Given** a settings.json file contains invalid JSON, **When** the system loads configuration, **Then** it reports the invalid configuration and does not fall back to previous valid configuration
2. **Given** a settings.json file contains valid JSON but invalid structure, **When** configuration is loaded, **Then** users receive clear feedback about what configuration took effect
3. **Given** configuration is successfully loaded, **When** the system starts, **Then** users are notified which configuration files are active and their contents

---

### Edge Cases

- What happens when settings.json files contain invalid configuration during the refactor process?
- How does the system handle configuration loading failures when dependencies change between old and new architecture?
- What occurs when environment variables are set both through traditional means and through Wave configuration during transition?
- How should the system behave when multiple configuration files exist but some contain invalid content without fallback mechanisms?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST eliminate redundant passing of environment variables to hook execution since they are already available in `process.env`
- **FR-002**: System MUST move settings.json loading, validation, and merging logic from hook-specific files to centralized configuration modules
- **FR-003**: System MUST maintain backward compatibility for existing configuration behavior during the refactor
- **FR-004**: System MUST ensure that Wave configuration environment variables always override existing process.env values when applied
- **FR-005**: System MUST ensure that configuration validation and error handling remain functional after refactoring
- **FR-006**: Hook execution services MUST focus solely on hook execution logic without embedded configuration management concerns
- **FR-007**: Configuration services MUST be accessible from any SDK component that needs configuration functionality
- **FR-008**: System MUST maintain all existing configuration file watching and live reload capabilities
- **FR-009**: System MUST simplify configuration loading by removing fallback mechanisms when loading Wave configuration from JSON files and instead notify users when configuration takes effect, even if invalid

### Key Entities *(include if feature involves data)*

- **ConfigurationService**: Centralized service for loading, validating, and merging Wave configuration from settings.json files
- **EnvironmentManager**: Service for managing environment variables from Wave configuration and integration with process.env
- **HookExecutionService**: Refactored hook service focused solely on command execution without embedded configuration logic
- **ConfigurationWatcher**: Existing service that monitors configuration file changes (will remain largely unchanged)
- **LiveConfigManager**: Existing orchestration service (may need updates to work with refactored configuration services)