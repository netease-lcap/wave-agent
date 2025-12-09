# Data Model: Default Permission Mode Setting

## Configuration Entities

### WaveConfiguration (Extended)
**Purpose**: Existing configuration interface extended to include default permission mode  
**Location**: `packages/agent-sdk/src/types/hooks.ts`

**Attributes**:
- `hooks`: Hook[] - Existing hook configurations
- `env`: Record<string, string> - Existing environment variables  
- `defaultMode`: "default" | "bypassPermissions" | undefined - New optional permission default

**Validation Rules**:
- `defaultMode` must be either "default", "bypassPermissions", or undefined
- Invalid values trigger validation warning and fallback to undefined
- Missing field treated as undefined (no default permission override)

### PermissionContext (Runtime)
**Purpose**: Runtime context for permission decision making  
**Location**: `packages/agent-sdk/src/managers/PermissionManager.ts`

**Attributes**:
- `configuredMode`: "default" | "bypassPermissions" | undefined - From configuration
- `cliOverride`: boolean - Whether command-line flags are present
- `effectiveMode`: "default" | "bypassPermissions" - Final resolved mode

**Resolution Logic**:
```
effectiveMode = cliOverride ? cliMode : (configuredMode ?? "default")
```

## Configuration Hierarchy

### Settings Resolution Order
1. **Command-line flags** (highest precedence)
   - `--dangerously-skip-permissions` → "bypassPermissions"
   - No flags → use configuration defaultMode
   
2. **settings.local.json** (project-level override)
   - Local project-specific overrides
   - Typically gitignored, developer-specific
   
3. **settings.json (project-level)**
   - Project-wide defaults
   - Committed to repository
   
4. **settings.json (user-level)**  
   - User's global preferences
   - Stored in user config directory

5. **System default** (fallback)
   - "default" mode when no configuration present

### Configuration Structure

```json
{
  "hooks": [...],
  "env": {...},
  "defaultMode": "bypassPermissions"
}
```

## State Transitions

### Permission Mode Resolution
```
[Configuration Loading] 
  → [Hierarchy Resolution]
  → [Validation] 
  → [CLI Override Check]
  → [Effective Mode Determination]
  → [Permission Manager Initialization]
```

**Error States**:
- Invalid defaultMode value → Log warning + fallback to undefined
- Missing configuration file → Continue with next in hierarchy
- Malformed JSON → Log error + skip file

**Success States**:
- Configuration loaded → Apply defaultMode
- No configuration → Use system default
- CLI override present → Ignore configuration

## Relationships

- **WaveConfiguration** contains **defaultMode** setting
- **PermissionManager** consumes **PermissionContext**
- **ConfigurationWatcher** validates and provides **WaveConfiguration**
- **Agent** orchestrates configuration → permission manager flow

**Dependencies**:
- Configuration system provides input to permission system
- Permission system operates independently after initialization  
- CLI arguments override configuration at runtime