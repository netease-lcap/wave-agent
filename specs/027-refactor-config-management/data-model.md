# Data Model: Configuration Management Refactoring

**Date**: 2025-12-09  
**Feature**: Refactor Configuration Management  
**Purpose**: Define data structures for centralized configuration services

## Core Entities

### WaveConfiguration
**Purpose**: Root configuration object representing merged Wave settings
**Source**: Existing type, no changes needed
**Usage**: Loaded from settings.json files and passed between services

**Structure**:
```typescript
interface WaveConfiguration {
  hooks?: PartialHookConfiguration;
  env?: Record<string, string>;
  defaultMode?: string;
}
```

**Validation Rules**:
- All fields are optional
- `env` must be string-to-string mapping when present
- `hooks` must follow PartialHookConfiguration structure when present
- `defaultMode` must be valid mode identifier when present

### ConfigurationLoadResult
**Purpose**: Return type for configuration loading operations with status information
**Source**: New entity for simplified loading without fallbacks

**Structure**:
```typescript
interface ConfigurationLoadResult {
  configuration: WaveConfiguration | null;
  success: boolean;
  error?: string;
  sourcePath?: string;
  warnings: string[];
}
```

**Validation Rules**:
- `success` is true only when `configuration` is not null and no critical errors occurred
- `error` present only when `success` is false
- `sourcePath` indicates which file was successfully loaded (if any)
- `warnings` array contains non-critical issues (validation warnings, conflicts)

### EnvironmentMergeContext
**Purpose**: Result of merging environment variables with conflict tracking  
**Source**: Existing type in hook.ts, will be moved to EnvironmentService
**Usage**: Tracks environment variable merging between user and project configurations

**Structure**:
```typescript
interface EnvironmentMergeContext {
  userVars: Record<string, string>;
  projectVars: Record<string, string>;
  mergedVars: Record<string, string>;
  conflicts: Array<{
    key: string;
    userValue: string;
    projectValue: string;
    resolvedValue: string;
  }>;
}
```

**Validation Rules**:
- `resolvedValue` in conflicts always equals `projectValue` (project precedence)
- `mergedVars` contains union of user and project vars with project taking precedence
- `conflicts` array only includes vars that exist in both user and project with different values

### ConfigurationServiceOptions
**Purpose**: Configuration options for the centralized configuration service
**Source**: New entity to support service initialization

**Structure**:
```typescript
interface ConfigurationServiceOptions {
  workdir: string;
  logger?: Logger;
  enableValidation?: boolean;
  enableFallbacks?: boolean; // Will be false after refactor
}
```

**Validation Rules**:
- `workdir` must be valid directory path
- `enableValidation` defaults to true
- `enableFallbacks` will be deprecated and removed in refactor

### EnvironmentServiceOptions  
**Purpose**: Configuration options for environment variable management service
**Source**: New entity to support service initialization

**Structure**:
```typescript
interface EnvironmentServiceOptions {
  logger?: Logger;
}
```

**Validation Rules**:
- Simple service options with only logging support

## Entity Relationships

### Configuration Flow
1. `ConfigurationService` loads and validates `WaveConfiguration` from JSON files
2. `ConfigurationService` returns `ConfigurationLoadResult` with status and warnings
3. `EnvironmentService` extracts `env` field and processes it into `EnvironmentMergeContext`
4. `EnvironmentService` applies merged environment variables to `process.env`
5. `HookManager` receives validated `WaveConfiguration` for hook-specific processing

### Service Dependencies
- `ConfigurationService` depends on `configPaths` utilities for file path resolution
- `EnvironmentService` depends on `ConfigurationService` for configuration loading
- `LiveConfigManager` orchestrates both services and notifies consumers of changes
- `HookManager` consumes validated configuration without embedded loading logic

## State Transitions

### Configuration Loading States
1. **Initial**: No configuration loaded
2. **Loading**: Reading and parsing configuration files  
3. **Validating**: Checking configuration structure and values
4. **Ready**: Valid configuration loaded and available
5. **Error**: Configuration loading or validation failed
6. **Reloading**: Live reload in progress (maintains previous valid state)

### Environment Variable States
1. **Unprocessed**: Environment variables defined in configuration but not applied
2. **Merging**: Resolving conflicts between user and project environment variables
3. **Applied**: Environment variables set to `process.env`
4. **Conflict**: Environment variables have conflicts that need user attention

## Validation Rules Summary

### File-Level Validation
- JSON syntax must be valid
- Root object must be present
- Type checking for all optional fields

### Environment Variable Validation  
- Keys must follow naming conventions (alphanumeric + underscore)
- Values must be strings
- Warning for reserved system variable names
- Warning for empty values

### Configuration Structure Validation
- Hook events must be valid event names
- Hook configurations must be properly structured arrays
- Default mode must be recognized value when specified

### Cross-Service Validation
- Configuration loading and environment processing must be consistent
- No validation logic duplication between services
- Clear error propagation between service layers