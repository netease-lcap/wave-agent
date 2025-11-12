# Research: Refactor Hooks System File Structure

**Feature**: 009-refactor-hooks-structure | **Date**: 2025-11-12  
**Purpose**: Research architectural patterns and migration strategies for file structure refactoring

## Executive Summary

Research completed for refactoring Wave Agent SDK hooks system to align with Constitution VII Source Code Structure. Key findings include function-based refactoring patterns, import path migration strategies, and test file alignment approaches that maintain functionality while improving code organization.

## Research Findings

### 1. Class-to-Function Refactoring Pattern

**Decision**: Convert HookExecutor from singleton class to exported function modules  
**Rationale**: Aligns with functional programming patterns and eliminates singleton complexity while maintaining the same public interface  

**Pattern Analysis**:
- Current: `export class HookExecutor implements IHookExecutor`
- Target: Export individual functions `executeCommand`, `executeCommands`, `isCommandSafe`
- Maintain interface contract through function signatures
- Remove logger dependency injection in favor of pure functions

**Alternatives Considered**:
- Keep class but move to services → Rejected, user specifically requested function-based approach
- Create factory function → Rejected, adds unnecessary complexity
- Module-level singleton → Rejected, goes against functional approach

### 2. Import Path Migration Strategy

**Decision**: Update all import statements atomically during refactoring  
**Rationale**: Prevents intermediate broken states and ensures consistent imports across codebase

**Migration Pattern**:
```typescript
// From: import { HookManager } from "./hooks/index.js"
// To: import { HookManager } from "./managers/hookManager.js"

// From: import { HookExecutor } from "./hooks/index.js" 
// To: import { executeCommand, executeCommands } from "./services/hook.js"

// From: import { loadUserHooksConfig } from "./hooks/index.js"
// To: import { loadUserHooksConfig } from "./services/hook.js"
```

**Implementation Strategy**:
1. Create new files in target locations
2. Update all internal imports to reference new locations
3. Remove old files and directories
4. Update main index.ts exports

**Alternatives Considered**:
- Gradual migration with re-exports → Rejected, creates temporary complexity
- Maintain backwards compatibility → Rejected, user specified to remove hooks export

### 3. Test File Alignment Approach

**Decision**: Mirror source structure exactly in tests directory  
**Rationale**: Follows Constitution III Test Alignment principle for predictable discovery

**Test Migration Mapping**:
```
tests/hooks/manager.test.ts     → tests/managers/hookManager.test.ts
tests/hooks/executor.test.ts    → tests/services/hook.test.ts  
tests/hooks/matcher.test.ts     → tests/utils/hookMatcher.test.ts
tests/hooks/settings.test.ts    → tests/services/hook.test.ts (merged with executor tests)
tests/hooks/types.test.ts       → tests/types/hooks.test.ts
```

**Test Import Updates**:
- Update all test imports to reference new file locations
- Maintain existing test logic and assertions
- Ensure test discovery continues to work with Vitest

**Alternatives Considered**:
- Keep tests in hooks directory → Rejected, violates Constitution III
- Feature-based test organization → Rejected, simple module mapping preferred

### 4. Type System Reorganization

**Decision**: Create dedicated types directory structure with index.ts aggregation  
**Rationale**: Improves type discoverability and follows common TypeScript patterns

**Type Organization**:
- `src/types.ts` → `src/types/index.ts` (main type exports)
- `src/hooks/types.ts` → `src/types/hooks.ts` (hook-specific types)
- Maintain all type exports through index.ts re-exports

**Import Pattern**:
```typescript
// External consumers: import { Agent, HookEvent } from "@wave/agent-sdk"
// Internal: import type { HookEvent } from "../types/hooks.js"
```

**Alternatives Considered**:
- Inline types in component files → Rejected, reduces reusability
- Single monolithic types.ts → Rejected, reduces modularity
- Types alongside source files → Rejected, user specified types/ directory

### 5. Service Module Consolidation Strategy

**Decision**: Merge hook executor and settings into single services/hook.ts file  
**Rationale**: Related functionality belongs together, reduces file fragmentation, improves cohesion

**Module Structure**:
```typescript
// services/hook.ts - Consolidated hook services
export {
  // Executor functions (from executor.ts)
  executeCommand,
  executeCommands, 
  isCommandSafe,
  // Settings functions (from settings.ts)
  getUserHooksConfigPath,
  getProjectHooksConfigPath,
  loadUserHooksConfig,
  loadProjectHooksConfig,
  loadMergedHooksConfig,
  hasHooksConfiguration,
  getHooksConfigurationInfo
}
```

**Organization Benefits**:
- Single import location for all hook-related services
- Clear separation between I/O operations and pure utilities
- Reduced cognitive overhead for developers
- Logical grouping of related functionality

**Alternatives Considered**:
- Separate files → Rejected, user prefers consolidation
- Include manager in services → Rejected, manager handles state (belongs in managers/)
- Include matcher in services → Rejected, matcher is pure utility (belongs in utils/)

### 6. Logger Dependency Removal Strategy

**Decision**: Remove logger parameter from hook executor functions  
**Rationale**: Simplifies function signatures and removes stateful dependencies

**Approach**:
- Remove logger constructor parameter and property
- Remove all logger.debug/info/error calls from executor
- Maintain error reporting through return values and exceptions
- Let calling code handle logging as needed

**Error Handling**:
- Return detailed error information in HookExecutionResult
- Throw HookExecutionError for unrecoverable failures
- Preserve all existing error context without logger dependency

**Alternatives Considered**:
- Pass logger to each function call → Rejected, clutters function signatures
- Use console logging → Rejected, not configurable
- Module-level logger → Rejected, creates global dependency

## Implementation Guidelines

### Phase 1: File Creation and Movement
1. Create new files in target directories (managers, services, utils, types)
2. Implement function-based executor without logger dependencies
3. Update internal imports within each moved file

### Phase 2: Import Path Updates
1. Update all source files to import from new locations
2. Update main index.ts to remove hooks/* exports
3. Update test files with new import paths and locations

### Phase 3: Cleanup and Validation
1. Remove src/hooks/ and tests/hooks/ directories
2. Run type checking and linting
3. Execute full test suite to verify functionality

## Risk Mitigation

**Build Integration Risk**: Minimal - changes are within single package  
**Mitigation**: Run `pnpm build` after all changes completed

**Test Discovery Risk**: Test files might not be found after movement  
**Mitigation**: Verify Vitest configuration supports new test file locations

**Import Resolution Risk**: TypeScript compilation errors from broken imports  
**Mitigation**: Update all imports atomically, verify with type checking

**Functionality Risk**: Hook execution behavior changes during refactoring  
**Mitigation**: Maintain exact function signatures and behavior, comprehensive testing

## Success Validation

- ✅ All tests pass with new file structure
- ✅ TypeScript compilation succeeds without errors  
- ✅ Hook functionality remains identical to current behavior
- ✅ Code organization follows Constitution VII patterns
- ✅ Test structure mirrors source code structure
- ✅ No logger dependencies in executor functions