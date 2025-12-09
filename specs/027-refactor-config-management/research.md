# Research: Configuration Management Refactoring

**Date**: 2025-12-09  
**Feature**: Refactor Configuration Management  
**Purpose**: Research current architecture to design clean separation of concerns

## Current Architecture Analysis

### Configuration Loading Flow

**Current Implementation**: Configuration loading is orchestrated through `hook.ts` with the following chain:
- `configPaths.ts` → path resolution
- `hook.ts` → file reading, parsing, validation, merging 
- `ConfigurationWatcher` → file watching and additional validation
- `LiveConfigManager` → orchestration and process.env updates
- `HookManager` → hook-specific configuration consumption

**Key Findings**:
- All core configuration logic is embedded in `hook.ts` (loading, validation, merging, fallbacks)
- Environment variables are processed twice: once to `process.env` and once passed to hook execution
- Complex fallback mechanisms exist at multiple levels (file, merged config, system)
- Configuration validation is split between `hook.ts` and `ConfigurationWatcher`

### Environment Variable Management

**Current Pattern**: 
1. `waveConfig.env` defined in settings.json files
2. `LiveConfigManager.updateEnvironmentFromSettings()` applies to `process.env`
3. `HookManager` passes same variables as `additionalEnvVars` to `executeCommand`
4. Hook execution receives variables both through `process.env` and explicit parameters

**Redundancy Issue**: Environment variables are available in `process.env` but still passed explicitly to hooks, creating duplication and potential inconsistencies.

### Configuration Service Dependencies

**Functions to Extract from `hook.ts`**:
- `loadWaveConfigFromFile*` family (all file loading variants)
- `loadMergedWaveConfig*` family (all merging variants) 
- `validateEnvironmentConfig` and `mergeEnvironmentConfig`
- Path utility re-exports

**Functions to Update in `hookManager.ts`**:
- `loadConfigurationFromSettings()` should receive pre-loaded configuration
- Validation functions should be consolidated with centralized validation

## Research Decisions

### Decision 1: Create Centralized ConfigurationService
**Rationale**: All core configuration loading, validation, and merging logic currently in `hook.ts` should be extracted to a dedicated service. This eliminates the conceptual coupling between configuration management and hook execution.

**Alternatives Considered**: 
- Keep configuration logic in `hook.ts` but separate concerns within the file
- Create multiple specialized services (loading, validation, merging separately)

**Rejected Because**: Single responsibility principle suggests configuration management should be one cohesive service, and hook services should focus solely on execution.

### Decision 2: Create EnvironmentService for Environment Variable Management
**Rationale**: Environment variable validation, merging, and application to `process.env` represents a distinct concern that should be separated from general configuration management.

**Alternatives Considered**:
- Keep environment logic within ConfigurationService
- Integrate environment management into LiveConfigManager

**Rejected Because**: Environment variable management has specific validation rules and lifecycle that warrant its own service. This also makes the functionality reusable beyond just Wave configuration.

### Decision 3: Eliminate Redundant Environment Variable Passing
**Rationale**: Since `waveConfig.env` variables are already set to `process.env`, there's no need to pass them separately to hook execution. This simplifies the interface and eliminates duplication.

**Alternatives Considered**:
- Keep explicit passing for backwards compatibility
- Use a hybrid approach with optional explicit passing

**Rejected Because**: The redundancy creates confusion and potential inconsistencies. Hooks can access environment variables through standard `process.env` access patterns.

### Decision 4: Simplify Fallback Mechanisms
**Rationale**: Current fallback behavior is complex with multiple layers. Simplified approach will load configuration directly and provide clear feedback about what took effect, rather than silent fallbacks to previous configurations.

**Alternatives Considered**:
- Keep existing robust fallback system
- Implement partial fallbacks for different configuration sections

**Rejected Because**: User feedback indicated preference for transparency over silent fallbacks. Users should know immediately when their configuration is invalid.

### Decision 5: Maintain Existing Configuration File Structure
**Rationale**: The current settings.json file structure and path resolution logic works well and is established in the user ecosystem. Changes should focus on internal architecture only.

**Alternatives Considered**:
- Introduce new configuration file formats
- Change configuration file naming or locations

**Rejected Because**: No user complaints about current file structure, and changing it would create unnecessary migration burden.

## Technical Approach

### New Services Architecture
1. **ConfigurationService**: Centralized loading, parsing, validation, and merging of Wave configuration
2. **EnvironmentService**: Specialized handling of environment variables from configuration to process.env
3. **HookExecutionService**: Refactored hook.ts focused solely on command execution

### Integration Strategy  
- `LiveConfigManager` will use new ConfigurationService instead of calling hook.ts functions
- `ConfigurationWatcher` will delegate to ConfigurationService for loading/validation
- `HookManager` will receive pre-loaded configuration from ConfigurationService
- All services maintain existing public interfaces to ensure backward compatibility

### Migration Plan
1. Create new services with existing functionality
2. Update consumers to use new services
3. Remove configuration logic from hook.ts
4. Simplify fallback mechanisms
5. Update tests to reflect new architecture