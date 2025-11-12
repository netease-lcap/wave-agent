# Research: Split Types by Domain

**Date**: 2025-11-12  
**Feature**: 010-split-types-by-domain  
**Purpose**: Analyze current type structure and define domain organization strategy

## Domain Organization Analysis

### Current State Assessment

**File**: `packages/agent-sdk/src/types/index.ts`
- **Size**: 358 lines
- **Type Count**: 40+ interfaces and types  
- **Constants**: 2 major constant objects
- **Issues**: Monolithic structure, unused types, poor discoverability

### Research Findings

#### Decision 1: Domain Grouping Strategy
**Decision**: Organize types into 7 domain files plus core shared types  
**Rationale**: Analysis shows natural clustering around functional areas (messaging, MCP, skills, etc.) with clear separation of concerns  
**Alternatives considered**: 
- Single refactor with just 3-4 domains (rejected - too broad, still hard to navigate)
- 10+ micro-domains (rejected - over-fragmentation, import complexity)

#### Decision 2: Core Types Layer Pattern  
**Decision**: Create `types/core.ts` for shared foundational types (Logger, Usage, ConfigurationError, constants)  
**Rationale**: Prevents circular dependencies and provides stable foundation for domain types  
**Alternatives considered**:
- Duplicate shared types in each domain (rejected - violates DRY principle)
- Complex import graph (rejected - creates circular dependency risk)

#### Decision 3: Unused Type Removal
**Decision**: Remove AIRequest, AIResponse, ConfigurationResolver, ConfigurationValidator interfaces  
**Rationale**: Codebase search confirms zero consumers; interfaces exist but implementations use object literals  
**Alternatives considered**:
- Keep interfaces for future use (rejected - YAGNI principle, creates confusion)
- Mark as deprecated first (rejected - no evidence of future need)

#### Decision 4: Backward Compatibility Strategy
**Decision**: Maintain full re-exports in main index.ts for seamless migration  
**Rationale**: Zero breaking changes required, allows gradual adoption of domain-specific imports  
**Alternatives considered**:
- Breaking change with migration guide (rejected - unnecessary developer friction)
- Dual export system (rejected - adds complexity without clear benefit)

### Domain Structure Design

```
types/
├── core.ts          # Logger, Usage, ConfigurationError, CONFIG_ERRORS
├── messaging.ts     # Message, MessageBlock union, all block variants  
├── mcp.ts          # McpServerConfig, McpConfig, McpTool, McpServerStatus
├── processes.ts     # BackgroundShell (extensible for future process types)
├── commands.ts      # SlashCommand, CustomSlashCommand, related configs
├── skills.ts        # Complete skill system: metadata, validation, constants
├── config.ts        # GatewayConfig, ModelConfig (agent configuration)
└── index.ts         # Barrel exports for backward compatibility
```

### Dependency Analysis

**Dependency Flow**: Domain Types → Core Types (no circular dependencies)
- **messaging.ts**: imports Usage from core.ts
- **skills.ts**: imports Logger from core.ts  
- **Other domains**: Independent of each other
- **core.ts**: No imports from other type files

**Import Patterns**:
```typescript
// Domain-specific import (new capability)  
import { Message, ToolBlock } from 'wave-agent-sdk/types/messaging';

// Backward compatible import (continues to work)
import { Message, ToolBlock } from 'wave-agent-sdk/types';
```

### Implementation Approach

#### Phase 1: Foundation
1. Create `types/core.ts` with shared types
2. Extract each domain into separate files
3. Update `types/index.ts` to re-export all domains

#### Phase 2: Cleanup  
1. Remove unused interfaces after confirming zero usage
2. Update package.json exports for domain-specific imports
3. Add integration tests for import patterns

#### Phase 3: Validation
1. Verify TypeScript compilation passes
2. Confirm all existing code works unchanged
3. Test tree-shaking works with domain imports

### Type Safety Guarantees

- **No Breaking Changes**: All existing imports continue to work
- **Type Integrity**: Cross-domain type relationships preserved  
- **Circular Dependency Prevention**: Core layer pattern ensures clean imports
- **Future Extensibility**: Domain structure allows easy addition of new type categories

### Performance Impact

- **Bundle Size**: Potential improvement through better tree-shaking
- **Compilation**: No impact, same total type definitions
- **Developer Experience**: Improved through targeted imports and better organization

## Conclusion

The domain organization provides clear separation of concerns while maintaining backward compatibility. The core types pattern prevents circular dependencies, and the strategic removal of unused types reduces cognitive load. This foundation supports the SDK's evolution while improving developer experience.