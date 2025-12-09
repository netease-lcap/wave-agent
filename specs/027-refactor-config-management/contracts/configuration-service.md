# Configuration Service Contract

## Interface Definition

```typescript
interface ConfigurationService {
  // Core loading operations
  loadConfiguration(workdir: string): Promise<ConfigurationLoadResult>;
  loadConfigurationFromFile(filePath: string): Promise<ConfigurationLoadResult>;
  loadMergedConfiguration(workdir: string): Promise<ConfigurationLoadResult>;
  
  // Validation operations
  validateConfiguration(config: WaveConfiguration): ValidationResult;
  validateConfigurationFile(filePath: string): ValidationResult;
  
  // Utility operations  
  getCurrentConfiguration(): WaveConfiguration | null;
  getConfigurationPaths(workdir: string): ConfigurationPaths;
}

interface ConfigurationLoadResult {
  configuration: WaveConfiguration | null;
  success: boolean;
  error?: string;
  sourcePath?: string;
  warnings: string[];
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface ConfigurationPaths {
  userPaths: string[];
  projectPaths: string[];
  allPaths: string[];
  existingPaths: string[];
}
```

## Service Behaviors

### loadConfiguration(workdir: string)
**Purpose**: Load and merge configuration from user and project settings
**Input**: Working directory path
**Output**: Configuration load result with merged configuration
**Behavior**: 
- Resolves configuration file paths for user and project
- Loads configurations in priority order (local.json > json, project > user)
- Merges configurations with project taking precedence
- Validates merged result
- Returns result with clear success/error status

### loadConfigurationFromFile(filePath: string)  
**Purpose**: Load configuration from single file
**Input**: Path to specific settings.json file
**Output**: Configuration load result from single file
**Behavior**:
- Reads and parses JSON from specified file
- Validates configuration structure
- Does not perform merging
- Returns result with file-specific errors/warnings

### loadMergedConfiguration(workdir: string)
**Purpose**: Load and merge configuration with comprehensive validation
**Input**: Working directory path  
**Output**: Fully validated merged configuration
**Behavior**:
- Loads user and project configurations
- Merges using established precedence rules
- Validates complete merged result
- Returns detailed validation results

### validateConfiguration(config: WaveConfiguration)
**Purpose**: Validate configuration object structure and values
**Input**: Configuration object to validate
**Output**: Validation result with errors/warnings
**Behavior**:
- Validates hooks structure and event names
- Validates environment variable structure
- Checks defaultMode value
- Returns comprehensive validation feedback

### validateConfigurationFile(filePath: string)
**Purpose**: Validate configuration file without loading
**Input**: Path to configuration file
**Output**: File-level validation result
**Behavior**:
- Checks JSON syntax
- Validates file structure
- Does not merge with other configurations
- Returns file-specific validation issues

### getCurrentConfiguration()
**Purpose**: Get currently loaded configuration
**Input**: None
**Output**: Current configuration or null
**Behavior**:
- Returns last successfully loaded configuration
- Returns null if no configuration loaded
- Does not trigger new loading

### getConfigurationPaths(workdir: string)
**Purpose**: Resolve all configuration file paths
**Input**: Working directory path
**Output**: Object containing various path arrays
**Behavior**:
- Returns user and project configuration paths
- Indicates which files actually exist
- Provides paths in priority order

## Error Handling

### File System Errors
- File not found: Return success=false with appropriate error message
- Permission denied: Return success=false with permission error
- Invalid JSON: Return success=false with syntax error details

### Validation Errors  
- Invalid configuration structure: Return errors array with specific issues
- Invalid environment variables: Return warnings for naming issues, errors for type issues
- Invalid hook configuration: Return errors with specific hook validation failures

### Service Errors
- Service not initialized: Throw initialization error
- Invalid parameters: Throw parameter validation error
- Internal errors: Log error and return service error result

## Dependencies

### Required Dependencies
- `configPaths` utilities for path resolution
- `fs` module for file system operations
- `Logger` interface for optional logging
- Type definitions for `WaveConfiguration` and related types

### Service Dependencies
- No dependencies on other configuration services
- Can be used independently for configuration loading
- Provides foundation for other configuration services