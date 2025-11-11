# Data Model: SessionDir Constructor Argument

**Date**: 2025-11-11  
**Feature**: SessionDir Constructor Argument  
**Purpose**: Define data entities and relationships for configurable session directory functionality

## Core Entities

### AgentOptions (Extended)

**Description**: Configuration interface for Agent constructor, extended to include session directory customization

**Fields**:
- `sessionDir?: string` - Optional custom directory path for session storage
- `apiKey?: string` - Existing: API key for gateway communication  
- `baseURL?: string` - Existing: Base URL for gateway communication
- `agentModel?: string` - Existing: Model configuration for agent operations
- `fastModel?: string` - Existing: Model configuration for fast operations
- `tokenLimit?: number` - Existing: Token limit configuration
- `callbacks?: AgentCallbacks` - Existing: Event callbacks
- `restoreSessionId?: string` - Existing: Session restoration
- `continueLastSession?: boolean` - Existing: Continue last session flag
- `logger?: Logger` - Existing: Logger instance
- `messages?: Message[]` - Existing: Initial messages for testing
- `workdir?: string` - Existing: Working directory
- `systemPrompt?: string` - Existing: Custom system prompt

**Validation Rules**:
- `sessionDir` must be a valid path string if provided
- `sessionDir` should be absolute path (recommended) or relative to process.cwd()
- If `sessionDir` is empty string, should be treated as undefined (fallback to default)

**Relationships**:
- Used by Agent constructor
- Passed to MessageManager during initialization

### SessionConfiguration (Internal)

**Description**: Internal configuration object that resolves session directory settings

**Fields**:
- `sessionDir: string` - Resolved session directory path (never undefined internally)
- `isCustomDir: boolean` - Flag indicating if using custom directory (useful for logging/debugging)

**State Transitions**:
1. **Unresolved** → **Default**: When `AgentOptions.sessionDir` is undefined
2. **Unresolved** → **Custom**: When `AgentOptions.sessionDir` is provided

**Validation Rules**:
- `sessionDir` must be absolute path after resolution
- Directory must be creatable (checked during first session operation)

**Relationships**:
- Created by MessageManager from AgentOptions
- Used by all session service functions

### SessionData (Existing - No Changes)

**Description**: Existing session data structure - unchanged by this feature

**Fields**:
- `id: string` - Session identifier
- `timestamp: string` - Creation timestamp  
- `version: string` - Session format version
- `messages: Message[]` - Conversation messages
- `metadata: SessionMetadata` - Session metadata

**Storage Location**:
- **Previous**: Always `~/.wave/sessions/session_{shortId}.json`
- **New**: `{sessionDir}/session_{shortId}.json` where sessionDir is configurable

### SessionMetadata (Existing - No Changes)

**Description**: Session metadata structure - unchanged by this feature

**Fields**:
- `id: string` - Session identifier
- `timestamp: string` - Creation timestamp
- `workdir: string` - Working directory when session created
- `startedAt: string` - Session start time
- `lastActiveAt: string` - Last activity time
- `latestTotalTokens: number` - Token usage

**Storage Context**: 
- Stored within SessionData
- Directory location determined by resolved sessionDir

## Data Flow

### Configuration Resolution

```
AgentOptions.sessionDir (optional)
    ↓
MessageManager constructor
    ↓
SessionConfiguration.sessionDir (resolved)
    ↓
Session service functions
    ↓
File system operations in resolved directory
```

### Session File Paths

**Default Behavior** (sessionDir not specified):
```
~/.wave/sessions/session_{shortId}.json
```

**Custom Behavior** (sessionDir specified):
```
{sessionDir}/session_{shortId}.json
```

### Directory Structure

Both default and custom directories follow same internal structure:
```
{sessionDir}/
├── session_abc12345.json
├── session_def67890.json
└── session_ghi13579.json
```

## Backward Compatibility

### Data Migration
- **Not Required**: Existing session files remain in `~/.wave/sessions/`
- **Access Pattern**: Default behavior unchanged, existing sessions accessible
- **New Sessions**: When `sessionDir` not specified, continue using default location

### API Compatibility  
- **Constructor**: New optional parameter, existing calls work unchanged
- **Session Operations**: All existing session methods work identically
- **File Format**: SessionData and SessionMetadata structures unchanged

## Validation Logic

### At Configuration Time
1. Validate `sessionDir` is string if provided
2. Resolve relative paths to absolute paths
3. Store resolved configuration in SessionConfiguration

### At Runtime (First Session Operation)
1. Ensure directory exists (create if needed)
2. Verify write permissions
3. Handle errors gracefully with clear messages

### Error Scenarios
- **Invalid Path**: Clear error message indicating sessionDir issue
- **Permission Denied**: Standard permission error with path information  
- **Disk Full**: Standard disk space error handling
- **Path Too Long**: Platform-specific path length validation