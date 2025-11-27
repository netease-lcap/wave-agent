# Internal Interface Contracts: Nested Command Discovery

**Feature**: Enhanced command discovery with nested directory support  
**Date**: 2025-11-27

## Interface: CustomCommandLoader

**Purpose**: Enhanced command loading with nested directory support

### Methods

#### loadCustomSlashCommands(workdir: string): CustomSlashCommand[]
**Description**: Synchronous loading of custom commands (backward compatible)
- **Input**: `workdir` - Project working directory path
- **Output**: Array of discovered custom slash commands
- **Behavior**: Scans both project and user command directories, supports nested structure
- **Error Handling**: Returns empty array on error, logs warnings

#### loadCustomSlashCommandsAsync(workdir: string): Promise<CustomSlashCommand[]>
**Description**: Asynchronous loading for better performance  
- **Input**: `workdir` - Project working directory path
- **Output**: Promise resolving to array of discovered commands
- **Behavior**: Same as sync version but with parallel directory scanning
- **Error Handling**: Rejects on critical errors, resolves with partial results on warnings

#### reloadCommands(workdir: string): void
**Description**: Force reload of command registry
- **Input**: `workdir` - Project working directory path  
- **Output**: void
- **Behavior**: Clears cache and rescans all directories
- **Error Handling**: Logs errors, maintains previous registry on failure

### Events
None - maintains existing synchronous interface pattern

## Interface: CommandPathResolver

**Purpose**: Convert file system paths to command identifiers

### Methods

#### generateCommandId(filePath: string, rootDir: string): string
**Description**: Generate command ID from file path
- **Input**: 
  - `filePath` - Absolute path to markdown file
  - `rootDir` - Root commands directory path
- **Output**: Command identifier string (e.g., "openspec:apply")
- **Behavior**: Converts path separators to colons, validates format
- **Error Handling**: Throws error on invalid path structure

#### parseCommandId(commandId: string): CommandIdParts
**Description**: Parse command ID into components
- **Input**: `commandId` - Command identifier (e.g., "openspec:apply")
- **Output**: Object with namespace and command name
- **Behavior**: Splits on colon, validates each component
- **Error Handling**: Throws error on malformed command ID

#### validateCommandId(commandId: string): boolean
**Description**: Validate command ID format
- **Input**: `commandId` - Command identifier to validate
- **Output**: Boolean indicating validity
- **Behavior**: Checks against regex pattern `/^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/`
- **Error Handling**: Returns false for invalid format, never throws

## Interface: CommandRegistry

**Purpose**: Manage command discovery and conflict resolution

### Methods

#### registerCommand(command: CustomSlashCommand): void
**Description**: Register a command in the registry
- **Input**: `command` - Command object to register
- **Output**: void
- **Behavior**: Adds to registry using existing conflict resolution (project overrides user)
- **Error Handling**: Logs warnings for duplicate IDs

#### unregisterCommand(commandId: string): boolean  
**Description**: Remove command from registry
- **Input**: `commandId` - ID of command to remove
- **Output**: Boolean indicating if command was found and removed
- **Behavior**: Removes from registry
- **Error Handling**: Returns false if command not found

#### getCommand(commandId: string): CustomSlashCommand | undefined
**Description**: Retrieve command by ID
- **Input**: `commandId` - Command identifier
- **Output**: Command object or undefined if not found  
- **Behavior**: Direct lookup from registry map
- **Error Handling**: Returns undefined for missing commands

#### getAllCommands(): CustomSlashCommand[]
**Description**: Get all registered commands
- **Input**: None
- **Output**: Array of all registered commands
- **Behavior**: Returns array from registry values
- **Error Handling**: Never throws, returns empty array if registry empty

## Type Definitions

### CommandIdParts
```typescript
interface CommandIdParts {
  namespace?: string;      // e.g., "openspec" for "openspec:apply"
  commandName: string;     // e.g., "apply" for "openspec:apply"  
  isNested: boolean;       // true if command has namespace
  depth: number;           // 0 for root, 1 for nested
}
```

### ValidationResult
```typescript
interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  type: 'DUPLICATE_COMMAND' | 'INVALID_FORMAT';
  message: string;
  affectedCommands: string[];
}

interface ValidationWarning {
  type: 'DEEP_NESTING_IGNORED' | 'INVALID_FILENAME';
  message: string;
  filePath: string;
}
```

### Enhanced CustomSlashCommand
```typescript
interface CustomSlashCommand {
  // Existing fields
  id: string;
  name: string; 
  description?: string;
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;
  
  // New nested command fields
  namespace?: string;      // Parent directory for nested commands
  isNested: boolean;       // Whether command is in subdirectory
  depth: number;           // 0 = root, 1 = nested
  segments: string[];      // Path components ["openspec", "apply"]
}
```

## Error Handling Contracts

### Error Types
- **FileSystemError**: Directory access or file reading failures
- **ValidationError**: Command ID format validation failures  
- **ParsingError**: Markdown file parsing failures
- **RegistryError**: Command registration or lookup failures

### Error Response Format
```typescript
interface CommandError {
  type: 'FILESYSTEM' | 'VALIDATION' | 'PARSING' | 'REGISTRY';
  message: string;
  filePath?: string;
  commandId?: string;
  originalError?: Error;
}
```

## Integration Points

### SlashCommandManager Integration
- `getCommands()` method unchanged - returns all commands including nested
- Command lookup by ID supports both flat (`apply`) and nested (`openspec:apply`) syntax
- No changes required to existing command execution pipeline

### CommandSelector Integration  
- Receives enhanced command objects with nested metadata
- Display logic can use `namespace` field for categorization
- No interface changes required - additional fields are optional