# Environment Service Contract

## Interface Definition

```typescript
interface EnvironmentService {
  // Environment variable processing
  processEnvironmentConfig(env: Record<string, string> | undefined): EnvironmentProcessResult;
  mergeEnvironmentConfigs(userEnv?: Record<string, string>, projectEnv?: Record<string, string>): EnvironmentMergeContext;
  applyEnvironmentVariables(env: Record<string, string>): void;
  
  // Validation operations
  validateEnvironmentConfig(env: unknown, source?: string): EnvironmentValidationResult;
  
  // Utility operations
  getCurrentEnvironmentVars(): Record<string, string>;
  getEnvironmentConflicts(): EnvironmentConflict[];
}

interface EnvironmentProcessResult {
  processedVars: Record<string, string>;
  conflicts: EnvironmentConflict[];
  warnings: string[];
  applied: boolean;
}

interface EnvironmentMergeContext {
  userVars: Record<string, string>;
  projectVars: Record<string, string>;
  mergedVars: Record<string, string>;
  conflicts: EnvironmentConflict[];
}

interface EnvironmentConflict {
  key: string;
  userValue: string;
  projectValue: string;
  resolvedValue: string;
  source: 'user' | 'project';
}

interface EnvironmentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface EnvironmentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
```

## Service Behaviors

### processEnvironmentConfig(env: Record<string, string> | undefined)
**Purpose**: Process environment configuration from Wave settings
**Input**: Environment variables object from configuration
**Output**: Processing result with applied variables and conflicts
**Behavior**:
- Validates environment variable structure
- Always applies variables to process.env (overrides existing values)
- Tracks what was applied and overwritten
- Returns comprehensive processing result

### mergeEnvironmentConfigs(userEnv?, projectEnv?)
**Purpose**: Merge user and project environment configurations
**Input**: Optional user and project environment variable objects
**Output**: Merge context with resolved variables and conflicts
**Behavior**:
- Starts with user environment variables
- Overlays project environment variables (project precedence)
- Tracks conflicts between user and project values
- Returns merged result with conflict information

### applyEnvironmentVariables(env: Record<string, string>)
**Purpose**: Apply environment variables to process.env
**Input**: Environment variables to apply
**Output**: None (void operation)
**Behavior**:
- Always applies variables to process.env (overrides existing values)
- Simple, direct application - no options needed

### validateEnvironmentConfig(env: unknown, source?)
**Purpose**: Validate environment configuration structure and values
**Input**: Environment config object and optional source identifier
**Output**: Comprehensive validation result
**Behavior**:
- Validates type is Record<string, string>
- Validates each variable name follows conventions
- Checks for reserved system variable names
- Warns about empty values
- Returns detailed validation feedback

### getCurrentEnvironmentVars()
**Purpose**: Get currently managed environment variables
**Input**: None
**Output**: Current environment variables managed by service
**Behavior**:
- Returns snapshot of environment variables managed by this service
- Does not include all process.env variables
- Only includes variables applied through this service

### getEnvironmentConflicts()
**Purpose**: Get current environment variable conflicts
**Input**: None
**Output**: Array of current conflicts
**Behavior**:
- Returns conflicts from last merge operation
- Includes user vs. project conflicts
- Includes process.env preservation conflicts

## Error Handling

### Validation Errors
- Invalid type for env config: Return validation error with type information
- Invalid variable names: Return warnings with specific naming issues
- Reserved variable conflicts: Return warnings about system variable overrides

### Application Errors
- Process environment access errors: Log error and continue with other variables
- Permission errors: Log warning and skip protected variables
- System variable conflicts: Warn but allow override based on options

### Service Errors
- Service not initialized: Throw initialization error
- Invalid parameters: Throw parameter validation error
- Internal processing errors: Log error and return partial results

## Dependencies

### Required Dependencies
- Node.js `process` global for environment variable access
- `Logger` interface for optional logging
- Type definitions for environment-related interfaces

### Service Dependencies
- Independent service with no configuration service dependencies
- Can be used standalone for environment variable management
- Integrates with ConfigurationService for Wave configuration processing

## Integration Points

### With ConfigurationService
- Processes `env` field from loaded WaveConfiguration
- Applies environment variables after configuration loading
- Validates environment config during configuration validation

### With LiveConfigManager
- Called during configuration reload to update process.env
- Provides conflict information for user notification
- Handles environment variable lifecycle during live reload

### With Process Environment
- Reads current process.env for conflict detection
- Applies new variables while respecting existing values
- Maintains separation between managed and system variables