# Data Model: Custom Slash Commands

**Generated**: December 19, 2024  
**Feature**: Custom Slash Commands

## Core Entities

### SlashCommand
**Purpose**: Base interface for all executable commands in the system

**Fields**:
- `id: string` - Unique identifier for command registration and lookup
- `name: string` - Display name shown in command selector and documentation  
- `description: string` - Human-readable description for discovery and help
- `handler: (args?: string) => Promise<void> | void` - Execution function

**Validation Rules**:
- `id` must be unique across all registered commands
- `name` must not contain whitespace or special characters
- `description` should be concise (recommended < 100 characters)
- `handler` must be a callable function

**Relationships**:
- Extended by `CustomSlashCommand` for file-based commands
- Registered in `SlashCommandManager` command registry
- Referenced by `CommandSelector` for UI display

### CustomSlashCommand
**Purpose**: File-based command definition with content and configuration

**Fields**:
- `id: string` - Inherited from SlashCommand (derived from filename)
- `name: string` - Inherited from SlashCommand (matches id unless overridden)
- `description?: string` - Optional custom description from frontmatter
- `filePath: string` - Absolute path to source markdown file
- `content: string` - Markdown content after frontmatter removal
- `config?: CustomSlashCommandConfig` - Parsed YAML frontmatter configuration
- `namespace?: string` - Parent directory for nested commands (e.g., "openspec")
- `isNested: boolean` - Whether command is in a subdirectory
- `depth: number` - Nesting level (0 = root, 1 = nested)
- `segments: string[]` - Path components for ID generation
- `pluginPath?: string` - Absolute path to the plugin root directory (only set for plugin commands)

**Validation Rules**:
- `filePath` must exist and be readable
- `content` cannot be empty after frontmatter processing
- `config` must parse as valid YAML if present
- File must have `.md` extension

**Relationships**:
- Implements `SlashCommand` interface
- Contains optional `CustomSlashCommandConfig`
- Managed by `SlashCommandManager` lifecycle
- Source files discovered by `customCommands.ts` utilities

**State Transitions**:
1. **Discovered** - File found during directory scan
2. **Parsed** - Frontmatter and content extracted successfully  
3. **Registered** - Added to command registry with generated handler
4. **Executable** - Available for user invocation
5. **Reloaded** - Updated when source file changes

### CustomSlashCommandConfig
**Purpose**: YAML frontmatter configuration for command behavior customization

**Fields**:
- `model?: string` - Preferred AI model for command processing
- `description?: string` - Custom description overriding auto-generated text
- `allowedTools?: string[]` - List of tool permission rules (e.g., `Bash(git status:*)`)

**Validation Rules**:
- `model` must be supported by AI provider
- `description` should be descriptive and concise
- `allowedTools` must be an array of strings
- Each `allowedTools` string should follow the `ToolName(pattern)` format

**Relationships**:
- Embedded within `CustomSlashCommand`
- Consumed by `AIManager` during command execution
- Parsed from YAML frontmatter by `markdownParser.ts`

**Default Behavior**:
- Missing fields inherit system defaults
- Undefined `model` uses default AI model configuration

## Command Registry Structure

### SlashCommandManager
**Purpose**: Central registry and lifecycle manager for all commands

**Internal State**:
- `commands: Map<string, SlashCommand>` - Active command registry
- `customCommands: Map<string, CustomSlashCommand>` - Custom command metadata cache

### PermissionManager (State Extension)
**Purpose**: Manages persistent and temporary tool execution permissions

**Internal State**:
- `allowedRules: string[]` - Persistent rules from settings
- `temporaryRules: string[]` - In-memory rules added for the duration of a slash command

**Operations**:
- `addTemporaryRules(rules: string[])` - Add rules for the current session
- `clearTemporaryRules()` - Remove all temporary rules
- `checkPermission(toolName: string, args: any)` - Validate against both rule sets

**Operations**:
- `registerCommand(command: SlashCommand)` - Add command to registry
- `unregisterCommand(commandId: string)` - Remove command from registry  
- `getCommands(): SlashCommand[]` - List all registered commands
- `executeCommand(commandId: string, args?: string)` - Invoke command handler
- `reloadCustomCommands()` - Refresh file-based commands

**Invariants**:
- Command IDs must be unique within registry
- Built-in commands cannot be overridden by custom commands
- Custom commands with identical names prioritize project-level over user-level

## File System Layout

### Command Discovery Paths
```
# Project-level commands (higher priority)
{workdir}/.wave/commands/
├── command1.md
├── command2.md
└── openspec/
    └── apply.md       # Discovered as /openspec:apply

# User-level commands (lower priority)  
~/.wave/commands/
├── global-command.md
└── personal-tool.md
```

**Rules**:
- Only `.md` files are considered for command loading
- Subdirectories are scanned up to 1 level deep
- Command ID derived from filename (root) or colon-separated path (nested)
- Project commands override user commands with same ID

### File Format Structure
```markdown
---
name: optional-override
description: Custom description text  
model: gpt-4
---

# Command Content

Markdown content with parameter substitution:
- Use $ARGUMENTS for all arguments
- Use $1, $2, $3 for positional parameters
- Support quoted arguments: "arg with spaces"

Bash commands can be embedded:
```bash
echo "Current directory: $(pwd)"
```
```

## Parameter Processing Model

### Argument Parsing
**Input**: Raw argument string from user (e.g., `arg1 "arg with spaces" arg3`)
**Processing**:
1. Tokenize respecting quoted boundaries
2. Handle escape sequences within quotes
3. Split on whitespace outside quotes
4. Generate positional array `[arg1, arg with spaces, arg3]`

**Substitution Variables**:
- `$ARGUMENTS` → Original raw argument string
- `$1` → First positional argument (empty string if not provided)
- `$2` → Second positional argument (empty string if not provided)
- `$N` → Nth positional argument (empty string if not provided)

**Processing Order**:
1. Parse command arguments into array
2. Check if content contains any parameter placeholders ($ARGUMENTS, $1, etc.)
3. If placeholders exist:
   a. Replace `$ARGUMENTS` with raw input
   b. Replace positional parameters `$N` in descending order
4. If NO placeholders exist and arguments are provided:
   a. Append arguments to the end of command content
5. If command is from a plugin (has `pluginPath`):
   a. Replace all `$WAVE_PLUGIN_ROOT` placeholders with the plugin's absolute path
6. Execute any embedded bash commands
7. Send processed content to AI manager
8. **AI Cycle Start**: `PermissionManager.addTemporaryRules()` is called with the extracted `allowedTools`.
9. **Tool Execution**: `PermissionManager.checkPermission()` matches against both `allowedRules` and `temporaryRules`. For `Bash` commands, it ensures every part of a command chain is allowed.
10. **AI Cycle End**: `PermissionManager.clearTemporaryRules()` is called in the `finally` block of `sendAIMessage`.

## Error States and Recovery

### Command Loading Errors
- **Invalid YAML**: Command skipped, warning logged, processing continues
- **File Read Error**: Command skipped, error logged, processing continues  
- **Missing File**: Command unregistered if previously loaded

### Command Execution Errors
- **Invalid Arguments**: Error message displayed in chat
- **Bash Timeout**: 30-second timeout with error message
- **AI Processing Error**: Standard AI error handling applies
- **Parameter Substitution Error**: Undefined parameters become empty strings

### Recovery Strategies
- Command registry remains functional with partial command set
- File system changes trigger automatic reload attempt  
- Error context preserved in chat history for debugging
- System continues operating with reduced command availability

## Performance Characteristics

### Memory Usage
- Command registry scales linearly with command count
- Each command stores metadata and content in memory
- Typical command: ~1-5KB memory footprint
- 50 commands ≈ 250KB memory overhead

### Execution Performance
- Command lookup: O(1) via Map structure
- Parameter substitution: O(n) where n = content length
- File discovery: O(m) where m = files in command directories
- UI responsiveness: <100ms for command selector updates

### Scalability Limits
- Practical limit: ~100-200 commands before UI becomes unwieldy
- Memory limit: ~10MB for 1000+ commands (theoretical)
- File system limit: Depends on directory scanning performance