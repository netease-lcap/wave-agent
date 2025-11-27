# Research: Nested Markdown Discovery Implementation

**Date**: 2025-11-27  
**Feature**: Nested command discovery for slash commands

## Key Technical Decisions

### Decision 1: Filesystem Traversal Approach
**Decision**: Controlled recursive scanning with depth limits  
**Rationale**: Current system uses synchronous `readdirSync` for flat scanning. Need to extend with controlled recursion to support exactly 1 level of nesting while preventing deeper traversal.  
**Alternatives considered**: 
- Glob patterns: Would require additional dependency
- Manual two-level scanning: Less flexible and harder to maintain
- Async recursive: Better performance but requires compatibility layer

### Decision 2: Command ID Generation Strategy  
**Decision**: Path-based colon syntax conversion  
**Rationale**: Direct mapping from file structure to command syntax provides intuitive user experience. `.wave/commands/openspec/apply.md` → `/openspec:apply` is clear and predictable.  
**Alternatives considered**:
- Flat namespace with prefixes: Less intuitive, harder to organize
- Hierarchical slash syntax: Conflicts with existing URL-like patterns
- Hash-based IDs: Not user-friendly

### Decision 3: Command ID Generation Strategy  
**Decision**: Path-based colon syntax conversion  
**Rationale**: Direct mapping from file structure to command syntax provides intuitive user experience. `.wave/commands/openspec/apply.md` → `/openspec:apply` is clear and predictable.  
**Alternatives considered**:
- Flat namespace with prefixes: Less intuitive, harder to organize
- Hierarchical slash syntax: Conflicts with existing URL-like patterns
- Hash-based IDs: Not user-friendly

### Decision 4: Performance Approach
**Decision**: Maintain synchronous interface with simple recursive scanning  
**Rationale**: Existing `slashCommandManager.ts` calls `loadCustomSlashCommands()` synchronously during initialization. Must maintain backward compatibility while keeping implementation simple.  
**Alternatives considered**:
- Full async conversion: Would require breaking changes to manager
- Blocking sync-only: Current approach, meets performance needs
- Complex caching: Over-engineered for typical command counts

### Decision 5: Type System Enhancement
**Decision**: Extend existing `CustomSlashCommand` interface with nested metadata  
**Rationale**: Minimal changes to existing code while adding necessary fields for nested command handling. Maintains backward compatibility with current command processing.  
**Alternatives considered**:
- Separate nested command type: Requires type discrimination logic
- Command inheritance hierarchy: Over-engineered for simple use case
- External metadata store: Adds complexity without clear benefits

## Implementation Strategy

### Phase 1: Core Functionality
- Extend `scanCommandsDirectory()` function with recursive logic
- Add path-to-command-ID conversion utilities  
- Update `CustomSlashCommand` interface with nested fields

### Phase 2: Integration  
- Update `slashCommandManager.ts` to handle colon syntax in command parsing
- Ensure `CommandSelector.tsx` receives nested commands correctly
- Add comprehensive test coverage for nested scenarios



## Technical Requirements

### New Utility Functions Needed
```typescript
// Core scanning function with depth control
function scanCommandsDirectoryRecursive(dirPath: string, maxDepth: number): CustomSlashCommand[]

// Command ID generation  
function generateCommandId(filePath: string, rootDir: string): string
```

### Type Extensions Required
```typescript
interface CustomSlashCommand {
  // Existing fields...
  namespace?: string;    // e.g., "openspec" for "openspec:apply"
  isNested: boolean;     // true for nested commands
  depth: number;         // 0 for root, 1 for nested
}
```

### Performance Characteristics
- **Target**: <50ms for command discovery of 100+ commands
- **Memory**: Minimal overhead over existing flat scanning
- **Startup impact**: <10ms additional initialization time

## Risk Assessment

### Low Risk
- **Backward compatibility**: Existing flat commands unaffected
- **UI integration**: No changes required to CommandSelector
- **Error handling**: Individual command failures isolated

### Medium Risk  
- **Command parsing**: Need to update slash command input parsing for colon syntax
- **Performance**: Recursive scanning could be slower than flat scanning
- **User migration**: Users need to understand new syntax patterns

### Mitigation Strategies
- Comprehensive test coverage for both flat and nested scenarios
- Performance benchmarking during development
- Clear documentation of new command syntax patterns