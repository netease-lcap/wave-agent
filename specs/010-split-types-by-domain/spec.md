# Feature Specification: Split Types by Domain

**Feature Branch**: `010-split-types-by-domain`  
**Created**: 2025-11-12  
**Status**: Draft  
**Input**: User description: "packages/agent-sdk/src/types/index.ts should be split by domain. and types have no consumer should be deleted, such as AIRequest AIResponse ConfigurationResolver ConfigurationValidator"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Imports Domain-Specific Types (Priority: P1)

Developers working with the agent SDK can import only the types they need from specific domains rather than importing from a single large types file, improving code organization and reducing bundle size.

**Why this priority**: This is the core value proposition - better type organization leads to cleaner imports, better tree-shaking, and improved maintainability.

**Independent Test**: Can be fully tested by importing specific type domains (e.g., `import { Message } from 'wave-agent-sdk/types/messaging'`) and verifying correct functionality without importing unused types.

**Acceptance Scenarios**:

1. **Given** a developer needs messaging types, **When** they import from `wave-agent-sdk/types/messaging`, **Then** they receive only messaging-related types without configuration or MCP types
2. **Given** a developer needs MCP server types, **When** they import from `wave-agent-sdk/types/mcp`, **Then** they receive only MCP-related types and interfaces
3. **Given** a developer needs configuration types, **When** they import from `wave-agent-sdk/types/configuration`, **Then** they receive gateway, model, and validation configuration types

---

### User Story 2 - Unused Types Removal (Priority: P2)

Developers no longer encounter unused type definitions in their IDE autocompletion and the codebase is cleaner without dead code.

**Why this priority**: Removing unused types reduces cognitive load and eliminates confusion, but is secondary to organizing the types that are actually used.

**Independent Test**: Can be fully tested by searching the entire codebase for removed type usage and confirming zero references exist.

**Acceptance Scenarios**:

1. **Given** unused types like AIRequest and AIResponse exist, **When** they are removed from the types, **Then** the codebase still compiles successfully
2. **Given** ConfigurationResolver and ConfigurationValidator interfaces exist but are not implemented, **When** they are removed, **Then** existing configuration utilities continue to work without interface contracts

---

### User Story 3 - Backward Compatibility for Existing Imports (Priority: P3)

Existing code that imports from the main types file continues to work without breaking changes during the transition period.

**Why this priority**: Maintains compatibility for existing consumers while allowing gradual migration to domain-specific imports.

**Independent Test**: Can be fully tested by running existing code that imports from `wave-agent-sdk/types` and verifying all functionality remains intact.

**Acceptance Scenarios**:

1. **Given** existing code imports from the main types index, **When** types are split into domains, **Then** the main index still exports all types for backward compatibility
2. **Given** TypeScript compilation of existing consumer code, **When** types are reorganized, **Then** compilation succeeds without type errors

---

### Edge Cases

- What happens when a type belongs to multiple domains (e.g., types shared between messaging and tools)?
- How does system handle circular dependencies between domain-specific type files?
- What happens when a consumer imports both domain-specific types and the main index?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST organize types into logical domain groupings (messaging, MCP, configuration, skills, tools, etc.)
- **FR-002**: System MUST remove unused type definitions that have no consumers in the codebase
- **FR-003**: System MUST maintain backward compatibility by re-exporting all domain types from the main index file
- **FR-004**: System MUST allow developers to import from specific domain files (e.g., `types/messaging`, `types/mcp`)
- **FR-005**: System MUST preserve all type relationships and dependencies between domains
- **FR-006**: System MUST remove AIRequest and AIResponse interfaces as they have no consumers
- **FR-007**: System MUST remove ConfigurationResolver and ConfigurationValidator interfaces as they are not implemented as contracts

### Key Entities *(include if feature involves data)*

- **Type Domain**: Logical grouping of related types (messaging, MCP, configuration, skills, tools, utilities)
- **Type Export**: Individual type definition that can be imported by consumers
- **Domain File**: Separate TypeScript file containing types for a specific domain
- **Main Index**: Central index file that re-exports all domain types for backward compatibility

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can import types from at least 5 separate domain files instead of one monolithic file
- **SC-002**: Main types index file is reduced by at least 30% in line count after removing unused types
- **SC-003**: All existing TypeScript compilation in the codebase passes without type errors after reorganization
- **SC-004**: Zero references to removed types (AIRequest, AIResponse, ConfigurationResolver, ConfigurationValidator) exist in the codebase after cleanup
- **SC-005**: Import statements for domain-specific types are 50% shorter than importing from main index (e.g., `wave-agent-sdk/types/messaging` vs `wave-agent-sdk/types/index`)