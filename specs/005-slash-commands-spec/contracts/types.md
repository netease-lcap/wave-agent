# TypeScript Interface Contracts

**Package**: agent-sdk  
**Generated**: December 19, 2024  
**Purpose**: Core type definitions for slash command system

## Core Command Interfaces

### SlashCommand Interface
Base interface for all executable commands in the system.

```typescript
export interface SlashCommand {
  id: string          // Unique identifier for command registration and lookup
  name: string        // Display name shown in command selector  
  description: string // Human-readable description for discovery and help
  handler: (args?: string) => Promise<void> | void // Execution function
}
```

**Contract Requirements**:
- `id` must be unique across all registered commands
- `name` must not contain whitespace or special characters
- `description` should be concise (recommended < 100 characters)
- `handler` must be a callable function returning void or Promise<void>

### CustomSlashCommand Interface
File-based command definition extending the base SlashCommand.

```typescript
export interface CustomSlashCommand {
  id: string                              // Derived from filename
  name: string                           // Matches id unless overridden
  description?: string                   // Optional from frontmatter
  filePath: string                       // Absolute path to source file
  content: string                        // Markdown content after frontmatter
  config?: CustomSlashCommandConfig      // Parsed YAML configuration
}
```

**Contract Requirements**:
- Implements SlashCommand interface
- `filePath` must exist and be readable
- `content` cannot be empty after frontmatter processing
- File must have `.md` extension

### CustomSlashCommandConfig Interface
YAML frontmatter configuration for command behavior customization.

```typescript
export interface CustomSlashCommandConfig {
  allowedTools?: string[]  // Whitelist of tools AI can use
  model?: string          // Preferred AI model for processing
  description?: string    // Custom description override
}
```

**Contract Requirements**:
- `allowedTools` elements must match available tool names
- `model` must be supported by AI provider
- All fields are optional with system defaults

## Manager Interfaces

### ISlashCommandManager Interface
Central orchestrator contract for command management.

```typescript
export interface ISlashCommandManager {
  // Registry Operations
  getCommands(): SlashCommand[]
  getCommand(commandId: string): SlashCommand | undefined
  hasCommand(commandId: string): boolean
  
  // Execution
  executeCommand(commandId: string, args?: string): Promise<boolean>
  parseAndValidateSlashCommand(input: string): SlashCommandParseResult
  
  // Custom Commands
  getCustomCommand(commandId: string): CustomSlashCommand | undefined
  getCustomCommands(): CustomSlashCommand[]
  reloadCustomCommands(): void
  
  // Control
  abortCurrentCommand(): void
}
```

### SlashCommandManagerOptions Interface
Configuration for SlashCommandManager initialization.

```typescript
export interface SlashCommandManagerOptions {
  messageManager: MessageManager  // For conversation handling
  aiManager: AIManager           // For command execution
  workdir: string               // Working directory context
  logger?: Logger              // Optional debugging output
}
```

## Parsing and Execution Interfaces

### SlashCommandParseResult Interface
Result of parsing and validating slash command input.

```typescript
export interface SlashCommandParseResult {
  isValid: boolean    // Whether input represents valid command
  commandId?: string  // Command identifier if valid and exists
  args?: string      // Arguments string if valid
}
```

### ParsedArguments Interface
Command argument parsing result with positional handling.

```typescript
export interface ParsedArguments {
  raw: string          // Original raw argument string
  positional: string[] // Parsed positional arguments array
}
```

### BashCommandResult Interface
Result of bash command execution within custom commands.

```typescript
export interface BashCommandResult {
  command: string  // Original bash command executed
  output: string   // Output from stdout, stderr, or error message
  exitCode: number // Exit code (0 for success, non-zero for error)
}
```

## UI Component Interfaces

### CommandSelectorProps Interface
Props for the interactive command selection component.

```typescript
export interface CommandSelectorProps {
  searchQuery: string                        // Current search query
  onSelect: (command: string) => void        // Command selection callback
  onInsert?: (command: string) => void       // Tab key insertion callback
  onCancel: () => void                       // Cancellation callback
  commands?: SlashCommand[]                  // Available commands
}
```

### CommandSelectorState Interface
Internal state for command selector component.

```typescript
export interface CommandSelectorState {
  selectedIndex: number          // Currently selected command index
  filteredCommands: SlashCommand[] // Commands matching search filter
  isVisible: boolean            // Whether selector is visible
}
```

### UseCommandSelectorResult Interface
Return type for command selection hook.

```typescript
export interface UseCommandSelectorResult {
  showSelector: boolean                           // Whether to show selector
  searchQuery: string                            // Current search query
  commands: SlashCommand[]                       // Available commands
  handleCommandSelect: (command: string) => void // Selection handler
  handleCommandInsert: (command: string) => void // Insertion handler
  handleSelectorCancel: () => void               // Cancellation handler
}
```

## Configuration and Discovery Interfaces

### CommandDiscoveryConfig Interface
Configuration for automatic command discovery.

```typescript
export interface CommandDiscoveryConfig {
  projectDir: string  // Project-level commands directory
  userDir: string    // User-level commands directory
  pattern: string    // File pattern for command files (*.md)
  recursive: boolean // Whether to scan recursively (false)
}
```

### CommandLoadResult Interface
Result of command loading operation with error tracking.

```typescript
export interface CommandLoadResult {
  loaded: CustomSlashCommand[]  // Successfully loaded commands
  errors: Array<{              // Errors encountered during loading
    filePath: string
    error: Error
  }>
}
```

## Execution Context Interfaces

### CommandExecutionContext Interface
Context information for command execution.

```typescript
export interface CommandExecutionContext {
  command: CustomSlashCommand    // Command being executed
  processedContent: string       // Content after parameter substitution
  originalInput: string         // Original user input
  args?: string                // Command arguments
}
```

### SubstitutionContext Interface
Context for parameter substitution operations.

```typescript
export interface SubstitutionContext {
  content: string              // Original content with placeholders
  arguments: ParsedArguments   // Parsed command arguments
}
```

### CommandExecutionOptions Interface
Options for customizing command execution behavior.

```typescript
export interface CommandExecutionOptions {
  timeout?: number         // Maximum execution timeout (default 30000ms)
  captureMetrics?: boolean // Whether to capture performance metrics
  workdir?: string        // Custom working directory
}
```

## Error Handling Interfaces

### CommandErrorType Enum
Standardized error types for command operations.

```typescript
export enum CommandErrorType {
  FILE_NOT_READABLE = 'file_not_readable',
  INVALID_YAML = 'invalid_yaml',
  EMPTY_CONTENT = 'empty_content',
  DUPLICATE_ID = 'duplicate_id',
  COMMAND_NOT_FOUND = 'command_not_found',
  BASH_TIMEOUT = 'bash_timeout',
  AI_PROCESSING_ERROR = 'ai_processing_error',
  PARAMETER_SUBSTITUTION_ERROR = 'parameter_substitution_error'
}
```

### CommandError Interface
Structured error type for command operations.

```typescript
export interface CommandError extends Error {
  type: CommandErrorType  // Specific error category
  commandId?: string     // Command ID if applicable
  filePath?: string      // File path if applicable
  originalError?: Error  // Underlying error if wrapped
}
```

## Performance and Metrics Interfaces

### CommandMetrics Interface
Performance metrics for command operations.

```typescript
export interface CommandMetrics {
  lookupTime: number      // Command lookup time in milliseconds
  substitutionTime: number // Parameter substitution time in ms
  executionTime: number   // Total execution time in milliseconds
  memoryUsage: number     // Memory usage in bytes
}
```

## Contract Guarantees

### Type Safety Requirements
- All interfaces must use strict TypeScript typing
- No `any` types allowed without explicit justification
- Optional fields must be explicitly marked with `?`
- Function signatures must specify return types

### Backward Compatibility
- Interface changes require semantic versioning
- Breaking changes need migration guide
- Deprecated fields must be marked and documented

### Performance Contracts
- Command lookup: O(1) complexity via Map storage
- Parameter substitution: O(n) where n = content length
- UI responsiveness: <100ms for selector operations
- Memory usage: Linear scaling with command count

### Error Handling Contracts
- All operations must handle errors gracefully
- Error types must be specific and actionable
- System must continue operating with partial failures
- Error context must be preserved for debugging

This contract specification ensures type safety, performance guarantees, and consistent behavior across all components of the custom slash commands feature.