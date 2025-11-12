# Data Model: Split Types by Domain

**Date**: 2025-11-12  
**Feature**: 010-split-types-by-domain  
**Purpose**: Define the logical organization and relationships of type domains

## Domain Entities

### Type Domain
**Purpose**: Logical grouping of related TypeScript type definitions  
**Attributes**:
- `name`: Domain identifier (core, messaging, mcp, processes, commands, skills, config)
- `filePath`: Physical location in types directory
- `dependencies`: Array of other domains this domain imports from
- `exports`: List of type names exported by this domain

**Relationships**:
- Has many **Type Exports**
- May depend on other **Type Domains** (unidirectional)

**Validation Rules**:
- Domain name must be unique
- No circular dependencies allowed between domains
- All dependencies must point to existing domains

### Type Export
**Purpose**: Individual TypeScript type, interface, or constant exported from a domain  
**Attributes**:
- `name`: TypeScript identifier name  
- `kind`: Type kind (interface, type alias, const, class)
- `isShared`: Whether type is used across multiple domains
- `usageCount`: Number of import references in codebase

**Relationships**:
- Belongs to exactly one **Type Domain**
- May reference other **Type Exports** (cross-domain or within-domain)

**Validation Rules**:
- Name must be valid TypeScript identifier
- Shared types should be placed in core domain
- No orphaned exports (must be imported somewhere)

### Domain Dependency
**Purpose**: Represents import relationship between type domains  
**Attributes**:
- `source`: Domain that imports
- `target`: Domain being imported from  
- `importedTypes`: Specific types imported
- `isRequired`: Whether dependency is mandatory for compilation

**Relationships**:
- Links two **Type Domains**

**Validation Rules**:
- No self-dependencies (domain importing from itself)
- No circular dependency chains
- Core domain cannot depend on any other domain

## Domain Organization

### Core Domain
- **Exports**: Logger, Usage, ConfigurationError, CONFIG_ERRORS
- **Dependencies**: None (foundation layer)
- **Purpose**: Shared foundational types used across multiple domains

### Messaging Domain  
- **Exports**: Message, MessageBlock, TextBlock, ErrorBlock, ToolBlock, ImageBlock, DiffBlock, CommandOutputBlock, CompressBlock, MemoryBlock, CustomCommandBlock, SubagentBlock
- **Dependencies**: Core (for Usage type)
- **Purpose**: Message representation and communication types

### MCP Domain
- **Exports**: McpServerConfig, McpConfig, McpTool, McpServerStatus  
- **Dependencies**: None
- **Purpose**: Model Context Protocol integration types

### Processes Domain
- **Exports**: BackgroundShell
- **Dependencies**: None  
- **Purpose**: Background process and shell management types

### Commands Domain
- **Exports**: SlashCommand, CustomSlashCommandConfig, CustomSlashCommand
- **Dependencies**: None
- **Purpose**: Command system and slash command types

### Skills Domain
- **Exports**: SkillMetadata, Skill, SkillFrontmatter, SkillCollection, SkillError, SkillValidationResult, SkillDiscoveryResult, SkillInvocationContext, SkillToolArgs, SkillManagerOptions, ParsedSkillFile, SkillParseOptions, SKILL_DEFAULTS
- **Dependencies**: Core (for Logger type)
- **Purpose**: Skill system types and configuration

### Config Domain
- **Exports**: GatewayConfig, ModelConfig
- **Dependencies**: None
- **Purpose**: Agent and service configuration types

## State Transitions

### Migration State Flow
1. **Initial State**: Single monolithic `types/index.ts` file
2. **Domain Creation**: Individual domain files created with specific type exports  
3. **Index Update**: Main index.ts updated to re-export all domain types
4. **Cleanup State**: Unused types removed, compilation verified
5. **Final State**: Domain-organized types with backward compatibility maintained

### Import Resolution Flow
1. **Legacy Import**: `import { Type } from 'wave-agent-sdk/types'` → Resolved via barrel export in index.ts
2. **Domain Import**: `import { Type } from 'wave-agent-sdk/types/domain'` → Direct domain file import
3. **Cross-Domain**: Domain file imports from other domains via relative paths

## Type Relationships

### Dependency Graph
```
Core (foundation)
├── Messaging (depends on Core for Usage)
├── Skills (depends on Core for Logger)
├── MCP (independent)
├── Processes (independent)  
├── Commands (independent)
└── Config (independent)
```

### Shared Type Usage
- **Logger**: Used by Skills domain, MCP management, various managers
- **Usage**: Used by Messaging domain for AI operation tracking
- **ConfigurationError**: Used by Config domain and related utilities
- **CONFIG_ERRORS**: Used by configuration validation and error handling

## File Structure Mapping

```
packages/agent-sdk/src/types/
├── core.ts          # Foundation layer: Logger, Usage, errors
├── messaging.ts     # Message communication types
├── mcp.ts          # Model Context Protocol types
├── processes.ts     # Background process types
├── commands.ts      # Command system types  
├── skills.ts        # Skill system types and constants
├── config.ts        # Configuration types
└── index.ts         # Barrel export for compatibility
```

## Validation Constraints

### Domain Integrity
- Each domain file must export at least one type
- No empty domain files allowed
- Domain files should not exceed 100 lines (maintainability)

### Dependency Management  
- Core domain cannot import from other domains
- Maximum dependency depth of 2 levels (Domain → Core)
- No transitive dependencies through multiple domains

### Backward Compatibility
- All types must remain accessible via main index export
- No breaking changes to existing type names or signatures
- Import resolution must work for both legacy and domain-specific patterns

This data model ensures clean separation of concerns while maintaining the relationships and dependencies necessary for the TypeScript type system to function correctly.