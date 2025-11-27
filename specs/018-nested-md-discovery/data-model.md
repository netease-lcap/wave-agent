# Data Model: Nested Command Discovery

**Feature**: Nested Markdown Discovery for Slash Commands  
**Date**: 2025-11-27

## Core Entities

### Command File
**Description**: A markdown file containing command definitions, located in `.wave/commands/` directory hierarchy.

**Fields**:
- `filePath: string` - Absolute path to the markdown file
- `relativePath: string` - Path relative to `.wave/commands/` directory  
- `lastModified: Date` - File modification timestamp for caching
- `size: number` - File size in bytes
- `isValid: boolean` - Whether file has valid markdown structure

**Validation Rules**:
- Must have `.md` extension
- Must be readable by current process
- Must contain valid markdown content
- File size must be < 1MB for performance

**State Transitions**:
- Created → Valid (successful parsing)
- Created → Invalid (parsing failure)  
- Valid → Modified (file system change)
- Invalid → Valid (after fixing and reload)

### Command Path  
**Description**: The directory structure path from `.wave/commands/` to the markdown file, converted to colon-separated command syntax.

**Fields**:
- `segments: string[]` - Path components (e.g., ["openspec", "apply"])
- `depth: number` - Nesting level (0 = root, 1 = nested)
- `commandId: string` - Final command identifier (e.g., "openspec:apply")
- `namespace?: string` - Parent directory name for nested commands

**Validation Rules**:
- Maximum depth of 1 (root + 1 level)
- Each segment must match pattern `/^[a-zA-Z0-9_-]+$/`
- Command ID must be unique across all discovered commands

**Relationships**:
- One-to-one with Command File
- Many Command Paths can share the same namespace

### Command Registry
**Description**: Internal data structure mapping command paths to their corresponding markdown files and metadata.

**Fields**:
- `commands: Map<string, CustomSlashCommand>` - Command ID to command mapping
- `lastScanTime: Date` - When registry was last updated
- `errors: CommandLoadError[]` - Errors encountered during loading

**Validation Rules**:
- No duplicate command IDs allowed
- Registry must be consistent (no orphaned references)

**State Transitions**:
- Empty → Loading (scan initiated)
- Loading → Ready (scan completed successfully)
- Loading → Error (scan failed)  
- Ready → Stale (file system changes detected)
- Stale → Loading (rescan triggered)

### Enhanced Custom Slash Command
**Description**: Extended version of existing `CustomSlashCommand` interface with nested command support.

**Fields** (additions to existing interface):
- `namespace?: string` - Parent directory for nested commands (e.g., "openspec")
- `isNested: boolean` - Whether command is in a subdirectory
- `depth: number` - Nesting level (0 = root, 1 = nested)
- `segments: string[]` - Path components for ID generation

**Validation Rules**:  
- If `isNested` is true, `namespace` must be defined
- If `depth` > 0, command must have parent namespace
- `segments` length must equal `depth + 1`
- All existing `CustomSlashCommand` validation still applies

**Relationships**:
- Extends existing `CustomSlashCommand`
- Belongs to exactly one Command Path
- May belong to a namespace (if nested)

## Data Flow

### Command Discovery Flow
1. **Scan Initiation**: System requests command reload
2. **Directory Traversal**: Recursive scan of `.wave/commands/` (max depth 1)
3. **Path Generation**: Convert file paths to command IDs using colon syntax
4. **Registry Update**: Update command registry with discovered commands using existing conflict resolution (project commands override user commands)
5. **Integration**: Commands available to slash command manager

### Command Execution Flow
1. **Input Parsing**: User types slash command (e.g., `/openspec:apply`)
2. **ID Resolution**: Parse command ID from input using colon separator
3. **Registry Lookup**: Find command in registry by parsed ID
4. **File Loading**: Load and parse markdown content from file path
5. **Execution**: Process command content through existing handler pipeline

## Performance Considerations

### Caching Strategy
- **Registry Cache**: Keep parsed commands in memory until file changes
- **File System Watching**: Use `fs.watch()` to detect directory changes  
- **Lazy Loading**: Load command content only when executed
- **Batch Updates**: Group multiple file changes into single registry update

### Memory Usage
- **Command Metadata**: ~200 bytes per command (estimated)
- **Registry Overhead**: ~1KB base + (metadata × command count)
- **For 100 commands**: ~21KB total memory footprint  
- **Cache Invalidation**: Clear unused commands after 24 hours

### Scalability Limits
- **Maximum Commands**: 1000 commands (practical limit)
- **Directory Depth**: 1 level maximum (enforced)
- **File Size**: 1MB per markdown file maximum  
- **Scan Time**: <50ms for 100 commands target