# SlashCommandManager API Contract

**Version**: 1.0.0  
**Package**: agent-sdk  
**Generated**: December 19, 2024

## Interface Definition

```typescript
interface SlashCommandManager {
  // Command Registry Operations
  getCommands(): SlashCommand[]
  getCommand(commandId: string): SlashCommand | undefined
  hasCommand(commandId: string): boolean
  
  // Command Execution
  executeCommand(commandId: string, args?: string): Promise<boolean>
  parseAndValidateSlashCommand(input: string): {
    isValid: boolean
    commandId?: string
    args?: string
  }
  
  // Custom Command Management
  getCustomCommand(commandId: string): CustomSlashCommand | undefined
  getCustomCommands(): CustomSlashCommand[]
  reloadCustomCommands(): void
  
  // Control Operations
  abortCurrentCommand(): void
}
```

## Command Registration Contract

### Built-in Command Registration
```typescript
interface BuiltinCommand {
  id: string          // Must be unique, no whitespace
  name: string        // Display name for UI
  description: string // Help text for users
  handler: (args?: string) => Promise<void> | void
}
```

**Invariants**:
- Built-in commands cannot be overridden
- Command IDs must be unique across registry
- Handlers must be callable functions

### Custom Command Discovery
```typescript
interface CustomCommandDiscovery {
  // Automatic discovery from filesystem
  scanDirectories: [
    "${workdir}/.wave/commands/",  // Project-level (priority)
    "${userHome}/.wave/commands/"  // User-level (fallback)
  ]
  
  // File selection criteria
  filePattern: "*.md"
  recursive: false  // Flat directory structure only
  
  // Precedence rules
  precedence: "project-over-user"  // Same name = project wins
}
```

## Command Execution Contract

### Input Validation
```typescript
interface CommandInputValidation {
  // Slash command syntax
  pattern: /^\/[a-zA-Z0-9\-_]+(\s+.*)?$/
  
  // Parsing result
  parseResult: {
    command: string    // Command name without "/"
    args: string      // Everything after first space
  }
  
  // Validation outcome
  validation: {
    isValid: boolean
    commandId?: string  // Only if valid and exists
    args?: string      // Only if valid
  }
}
```

### Parameter Substitution
```typescript
interface ParameterSubstitution {
  // Input processing
  argumentParsing: {
    respectQuotes: true
    handleEscapes: true
    splitPattern: /\s+/  // Outside quotes only
  }
  
  // Substitution variables
  variables: {
    "$ARGUMENTS": "original-raw-input"
    "$1": "first-positional-arg-or-empty"
    "$2": "second-positional-arg-or-empty"
    "$N": "nth-positional-arg-or-empty"
  }
  
  // Processing order
  order: [
    "parse-arguments",
    "substitute-$ARGUMENTS", 
    "substitute-positional-descending",
    "execute-bash-commands",
    "send-to-ai-manager"
  ]
}
```

### Bash Command Execution
```typescript
interface BashExecution {
  // Execution context
  workingDirectory: string  // Project workdir
  timeout: 30000           // 30 seconds
  
  // Result handling
  result: {
    command: string
    output: string    // stdout || stderr || error.message
    exitCode: number  // 0 for success
  }
  
  // Integration
  substitution: "replace-bash-blocks-with-output"
}
```

## Custom Command Configuration Contract

### YAML Frontmatter Schema
```yaml
# Optional command metadata
name: string              # Override default (filename-based)
description: string       # Custom description for UI

# AI behavior configuration  
model: string            # AI model preference
allowedTools: string[]   # Tool whitelist for security

# Example
---
name: project-info
description: "Show current project information"
model: gpt-4
allowedTools: [Read, Bash]
---
```

### Configuration Processing
```typescript
interface ConfigurationProcessing {
  // Parsing
  parser: "gray-matter"  // YAML frontmatter extraction
  
  // Validation
  validation: {
    allowedTools: "must-match-available-tools"
    model: "must-be-supported-by-ai-provider"
    description: "optional-string"
  }
  
  // Defaults
  defaults: {
    allowedTools: null      // No restrictions
    model: "system-default"
    description: "auto-generated"
  }
}
```

## Error Handling Contract

### Command Loading Errors
```typescript
interface LoadingErrorHandling {
  // Error types
  errorTypes: [
    "file-not-readable",
    "invalid-yaml-frontmatter", 
    "empty-content",
    "duplicate-command-id"
  ]
  
  // Recovery strategy
  recovery: "continue-processing"  // Skip bad commands
  logging: "warn-level"           // Log errors but don't crash
  
  // User impact
  impact: "partial-command-availability"
}
```

### Execution Errors
```typescript
interface ExecutionErrorHandling {
  // Error types
  errorTypes: [
    "command-not-found",
    "bash-timeout",
    "ai-processing-error",
    "parameter-substitution-error"
  ]
  
  // Error presentation
  presentation: {
    location: "chat-interface"
    format: "error-block"
    context: "preserve-conversation-history"
  }
  
  // Recovery
  recovery: "continue-conversation"  // Don't crash session
}
```

## Performance Guarantees

### Response Time Commitments
```typescript
interface PerformanceContract {
  commandLookup: {
    operation: "hasCommand(id)"
    guarantee: "<1ms"
    complexity: "O(1)"
  }
  
  parameterSubstitution: {
    operation: "substituteCommandParameters()"
    guarantee: "<5ms"  // Up to 10 parameters
    complexity: "O(n)" // n = content length
  }
  
  commandDiscovery: {
    operation: "loadCustomSlashCommands()"
    guarantee: "<200ms"  // Up to 50 commands
    complexity: "O(m)"   // m = files in directories
  }
  
  uiResponsiveness: {
    operation: "command-selector-display"
    guarantee: "<100ms"
    dependency: "command-registry-loaded"
  }
}
```

### Resource Usage Limits
```typescript
interface ResourceLimits {
  memory: {
    perCommand: "~1-5KB"
    total50Commands: "~250KB"
    practicalLimit: "100-200 commands"
  }
  
  fileSystem: {
    watchedDirectories: 2  // Project + user
    scanDepth: 1          // Flat structure only
    maxConcurrentFiles: 100
  }
  
  execution: {
    bashTimeout: "30 seconds"
    maxParameterCount: "unlimited"
    maxContentLength: "~1MB practical"
  }
}
```

## State Management Contract

### Command Registry State
```typescript
interface RegistryState {
  // Internal maps
  commands: Map<string, SlashCommand>
  customCommands: Map<string, CustomSlashCommand>
  
  // State transitions
  lifecycle: [
    "initialize-builtin-commands",
    "discover-custom-commands", 
    "parse-and-register",
    "ready-for-execution",
    "reload-on-file-changes"
  ]
  
  // Consistency guarantees
  invariants: [
    "unique-command-ids",
    "valid-handlers",
    "project-precedence-over-user"
  ]
}
```

### Reload Behavior
```typescript
interface ReloadContract {
  // Trigger conditions
  triggers: [
    "explicit-reloadCustomCommands-call",
    "file-system-change-notification"  // If implemented
  ]
  
  // Reload process
  process: [
    "clear-existing-custom-commands",
    "unregister-from-command-map",
    "re-scan-directories", 
    "re-parse-and-register",
    "preserve-builtin-commands"
  ]
  
  // Atomicity
  atomicity: "best-effort"  // Partial success possible
  rollback: "maintain-previous-working-set"
}
```

## Integration Points

### Agent Integration
```typescript
interface AgentIntegration {
  // Initialization
  dependencies: [
    "MessageManager",
    "AIManager", 
    "workdir-context"
  ]
  
  // Execution flow
  flow: [
    "parse-user-input",
    "validate-command",
    "substitute-parameters",
    "execute-bash-if-needed",
    "send-to-ai-manager",
    "handle-ai-response"
  ]
  
  // Context preservation
  context: "maintain-conversation-continuity"
}
```

### UI Integration  
```typescript
interface UIIntegration {
  // Command selector
  commandSelector: {
    trigger: "/ character in input"
    display: "overlay-on-input-box"
    navigation: "arrow-keys"
    selection: "enter-key"
    cancellation: "escape-key"
  }
  
  // Search functionality
  search: {
    trigger: "typing-after-slash"
    matching: "case-insensitive-name-filter"
    debouncing: "real-time-no-delay"
  }
  
  // State synchronization
  synchronization: "react-context-based"
}
```

This API contract defines the complete interface and behavior expectations for the custom slash commands feature, ensuring consistent implementation and integration across all components.