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
- `allowedTools?: string[]` - Whitelist of tools AI can use during execution
- `model?: string` - Preferred AI model for command processing
- `description?: string` - Custom description overriding auto-generated text

**Validation Rules**:
- `allowedTools` elements must match available tool names
- `model` must be supported by AI provider
- `description` should be descriptive and concise

**Relationships**:
- Embedded within `CustomSlashCommand`
- Consumed by `AIManager` during command execution
- Parsed from YAML frontmatter by `markdownParser.ts`

**Default Behavior**:
- Missing fields inherit system defaults
- Empty `allowedTools` array means no tool restrictions
- Undefined `model` uses default AI model configuration

## Command Registry Structure

### SlashCommandManager
**Purpose**: Central registry and lifecycle manager for all commands

**Internal State**:
- `commands: Map<string, SlashCommand>` - Active command registry
- `customCommands: Map<string, CustomSlashCommand>` - Custom command metadata cache

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
└── subfolder/         # Not scanned - flat structure only

# User-level commands (lower priority)  
~/.wave/commands/
├── global-command.md
└── personal-tool.md
```

**Rules**:
- Only `.md` files are considered for command loading
- Subdirectories are ignored - flat structure enforced
- Command ID derived from filename without `.md` extension
- Project commands override user commands with same ID

### File Format Structure
```markdown
---
name: optional-override
description: Custom description text  
model: gpt-4
allowedTools: [Read, Write, Bash]
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
2. Replace `$ARGUMENTS` with raw input
3. Replace positional parameters `$N` in descending order (prevents `$10` → `$1` + "0")
4. Execute any embedded bash commands
5. Send processed content to AI manager

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