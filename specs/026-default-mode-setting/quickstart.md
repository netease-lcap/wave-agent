# Quickstart: Default Permission Mode Setting

## For Users

### Basic Usage

1. **Set project-wide default** (affects all team members):
   ```json
   // settings.json (project root)
   {
     "defaultMode": "bypassPermissions"
   }
   ```

2. **Set personal override** (only affects you):
   ```json
   // settings.local.json (project root, gitignored)
   {
     "defaultMode": "default"
   }
   ```

3. **Set user-wide default** (affects all your projects):
   ```json
   // ~/.wave/settings.json
   {
     "defaultMode": "bypassPermissions"
   }
   ```

### Override for Single Run
```bash
# Override configuration for this run only
wave-agent --dangerously-skip-permissions

# Use default behavior (ignore configuration)
wave-agent  # Will respect configured defaultMode
```

### Configuration Values
- `"default"` - Prompt for confirmation on restricted tools (standard behavior)
- `"bypassPermissions"` - Skip all permission checks (equivalent to --dangerously-skip-permissions)

## For Developers

### Implementation Steps

1. **✅ WaveConfiguration Extended**:
   ```typescript
   // packages/agent-sdk/src/types/hooks.ts
   interface WaveConfiguration {
     hooks?: Hook[];
     env?: Record<string, string>;
     defaultMode?: "default" | "bypassPermissions"; // ✅ IMPLEMENTED
   }
   ```

2. **✅ ConfigurationWatcher Validation Added**:
   ```typescript
   // packages/agent-sdk/src/services/configurationWatcher.ts
   private validateConfiguration(config: WaveConfiguration): ValidationResult {
     // Validates defaultMode and provides clear error messages
     // ✅ IMPLEMENTED with comprehensive validation
   }
   ```

3. **✅ PermissionManager Updated**:
   ```typescript
   // packages/agent-sdk/src/managers/permissionManager.ts
   constructor(options: PermissionManagerOptions) {
     // Supports configuredDefaultMode parameter
     // Includes updateConfiguredDefaultMode() and resolveEffectivePermissionMode()
     // ✅ IMPLEMENTED with CLI override precedence
   }
   ```

4. **✅ Agent Integration Complete**:
   ```typescript
   // packages/agent-sdk/src/agent.ts
   static async create(options: AgentOptions) {
     // Automatically loads configuration and passes to PermissionManager
     // Handles CLI permissionMode override correctly
     // ✅ IMPLEMENTED in both interactive and print modes
   }
   ```

### ✅ Configuration Hierarchy (IMPLEMENTED)

The system now supports three levels of configuration with proper precedence:

**Resolution Order** (highest to lowest priority):
1. **CLI Flags** (`--dangerously-skip-permissions`)
2. **Local Project Config** (`settings.local.json`) 
3. **Project Config** (`settings.json`)
4. **User Config** (`~/.wave/settings.json`)

### ✅ Validation & Error Handling (IMPLEMENTED)

- **Invalid Values**: Clear error messages for invalid `defaultMode` values
- **Malformed JSON**: Graceful fallback to previous valid configuration
- **Missing Files**: Continues with remaining configuration sources
- **Live Reloading**: Configuration changes apply immediately

### Testing Configuration

**✅ Test the feature** (all user stories implemented):

1. **Basic Configuration Test**:
   ```bash
   # Create project settings
   echo '{"defaultMode": "bypassPermissions"}' > settings.json
   
   # Run wave-agent - should bypass permissions by default
   wave-agent --print "test message"
   ```

2. **CLI Override Test**:
   ```bash
   # With bypassPermissions config, force default mode for this run
   wave-agent --print "test message"  # CLI currently only supports bypass flag
   ```

3. **Settings Hierarchy Test**:
   ```bash
   # Create user config
   mkdir -p ~/.wave
   echo '{"defaultMode": "default"}' > ~/.wave/settings.json
   
   # Create project override  
   echo '{"defaultMode": "bypassPermissions"}' > settings.json
   
   # Project should win (bypassPermissions behavior)
   wave-agent --print "test message"
   ```

**Note**: Testing requires actual file operations and observing permission behavior during tool usage.

## Configuration Hierarchy Examples

### Example 1: Project Team Setup
```json
// settings.json (committed)
{
  "defaultMode": "default"
}

// settings.local.json (developer's machine, gitignored)  
{
  "defaultMode": "bypassPermissions"
}
```
**Result**: Developer bypasses permissions, other team members get prompts.

### Example 2: User Preference
```json
// ~/.wave/settings.json (user config)
{
  "defaultMode": "bypassPermissions"
}
```
**Result**: User bypasses permissions in all projects by default.

### Example 3: Override Chain
- User config: `"bypassPermissions"`
- Project config: `"default"`  
- Local config: `"bypassPermissions"`
- CLI flag: `--dangerously-skip-permissions`

**Resolution order**: CLI flag > Local > Project > User
**Final result**: CLI flag wins, permissions bypassed for this run only.