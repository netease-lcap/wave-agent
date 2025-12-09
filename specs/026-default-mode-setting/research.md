# Research: Default Permission Mode Setting

## Overview

Research findings for implementing defaultMode configuration setting in the Wave Agent permission system.

## Technical Decisions

### Decision: Extend WaveConfiguration Type
**Rationale**: The existing `WaveConfiguration` interface in `packages/agent-sdk/src/types/hooks.ts` should be extended with an optional `defaultMode` field to maintain type safety and integrate with the existing configuration system.

**Alternatives considered**: 
- Creating a separate permission configuration type
- Using environment variables for default mode

**Selected approach**: Add `defaultMode?: "default" | "bypassPermissions"` to `WaveConfiguration` interface

### Decision: Leverage Existing ConfigurationWatcher Service
**Rationale**: The `ConfigurationWatcher` service already handles file watching, validation, and live reloading for settings.json files. It should be extended to validate the defaultMode field.

**Alternatives considered**:
- Creating a separate configuration service for permissions
- Handling defaultMode validation in PermissionManager directly

**Selected approach**: Add defaultMode validation logic to `ConfigurationWatcher.validateConfiguration()` method

### Decision: Extend PermissionManager Initialization
**Rationale**: The `PermissionManager` already handles permission mode logic and should be the natural place to consume defaultMode configuration.

**Alternatives considered**:
- Handling defaultMode in Agent constructor directly
- Creating a separate DefaultModeManager

**Selected approach**: Modify `PermissionManager` constructor/initialization to accept configuration-based defaultMode

### Decision: Settings Hierarchy Implementation
**Rationale**: The existing configuration resolution should follow: `settings.local.json` > `settings.json` (project) > `settings.json` (user), with command-line flags taking highest precedence.

**Alternatives considered**:
- User-level precedence over project-level
- Separate configuration files for permissions

**Selected approach**: Implement hierarchy in configuration resolution logic, ensure command-line flags override configuration

## Integration Patterns

### Configuration Loading Flow
1. ConfigurationWatcher loads settings files in hierarchy order
2. Validates defaultMode values during configuration parsing
3. Passes resolved configuration to Agent initialization
4. Agent passes defaultMode to PermissionManager constructor
5. PermissionManager uses defaultMode when no CLI flags present

### Error Handling Strategy
- Invalid defaultMode values: Log warning, fall back to "default" behavior
- Missing configuration files: Graceful fallback to existing defaults
- Malformed JSON: Use existing error handling, maintain system stability

### Testing Strategy
- Unit tests: Individual component validation (ConfigurationWatcher, PermissionManager)
- Integration tests: End-to-end configuration loading and permission application
- Mock file system operations for deterministic testing
- Test settings hierarchy resolution logic

## Implementation Scope

**Minimal Changes Required**:
- Type extension: 1 line addition to WaveConfiguration interface
- Validation logic: ~10 lines in ConfigurationWatcher
- Permission initialization: ~5 lines in PermissionManager constructor
- Configuration resolution: ~15 lines for hierarchy logic

**No Breaking Changes**: All changes are additive, existing behavior preserved when defaultMode is not configured.

**Performance Impact**: Negligible - single property read during initialization, no runtime overhead.

## Risk Assessment

**Low Risk Implementation**:
- Leverages existing, proven configuration infrastructure
- Minimal code changes required
- No new dependencies or external integrations
- Comprehensive fallback behavior ensures system stability

**Mitigation Strategies**:
- Extensive unit testing of validation logic
- Integration testing of permission behavior
- Documentation of configuration hierarchy
- Clear error messages for configuration issues