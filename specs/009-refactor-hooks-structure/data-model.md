# Data Model: Refactor Hooks System File Structure

**Feature**: 009-refactor-hooks-structure | **Date**: 2025-11-12  
**Purpose**: Define data structures and relationships for hooks system refactoring

## Overview

This refactoring involves relocating existing hook system components without changing their core data structures. The data model documents the current entity relationships and how they will be maintained after file structure changes.

## Core Entities

### Hook Services Module (services/hook.ts)

**Purpose**: Consolidated hook services for execution and configuration  
**Location**: `packages/agent-sdk/src/services/hook.ts`

```typescript
// Hook Execution Functions (from executor.ts)
export function executeCommand(
  command: string,
  context: HookExecutionContext | ExtendedHookExecutionContext,
  options?: HookExecutionOptions
): Promise<HookExecutionResult>

export function executeCommands(
  commands: string[],
  context: HookExecutionContext | ExtendedHookExecutionContext,
  options?: HookExecutionOptions
): Promise<HookExecutionResult[]>

export function isCommandSafe(command: string): boolean

// Hook Settings Functions (from settings.ts)
export function getUserHooksConfigPath(): string
export function getProjectHooksConfigPath(workdir: string): string
export function loadHooksConfigFromFile(filePath: string): PartialHookConfiguration | null
export function loadUserHooksConfig(): PartialHookConfiguration | null
export function loadProjectHooksConfig(workdir: string): PartialHookConfiguration | null
export function loadMergedHooksConfig(workdir: string): PartialHookConfiguration | null
export function hasHooksConfiguration(workdir: string): boolean
export function getHooksConfigurationInfo(workdir: string): { hasUser: boolean; hasProject: boolean; paths: string[] }
```

**Key Changes**:
- Consolidates executor and settings functionality into single module
- Remove logger dependency parameter from executor functions
- Convert from class methods to standalone functions
- Maintain identical function signatures and behavior
- Preserve all timeout handling and process isolation logic
- Maintain all file I/O operations for configuration loading

### Hook Manager (managers/hookManager.ts)

**Purpose**: State management and orchestration for hook system  
**Location**: `packages/agent-sdk/src/managers/hookManager.ts`

```typescript
export class HookManager {
  loadConfiguration(userHooks?: PartialHookConfiguration, projectHooks?: PartialHookConfiguration): void
  loadConfigurationFromSettings(): void
  executeHooks(event: HookEvent, context: HookExecutionContext | ExtendedHookExecutionContext): Promise<HookExecutionResult[]>
  hasHooks(event: HookEvent, toolName?: string): boolean
  validateConfiguration(config: HookConfiguration): ValidationResult
  getConfiguration(): PartialHookConfiguration | undefined
}
```

**Relationships**:
- Depends on HookMatcher for pattern matching
- Depends on Hook services for command execution and configuration loading
- Manages HookConfiguration state
- Coordinates hook execution workflow

### Hook Matcher (utils/hookMatcher.ts)

**Purpose**: Pure utility functions for pattern matching  
**Location**: `packages/agent-sdk/src/utils/hookMatcher.ts`

```typescript
export interface IHookMatcher {
  matches(pattern: string, toolName: string): boolean
  isValidPattern(pattern: string): boolean  
  getPatternType(pattern: string): "exact" | "glob" | "regex" | "alternatives"
}

export class HookMatcher implements IHookMatcher
```

**Characteristics**:
- Stateless utility functions
- No external dependencies beyond minimatch
- Pure functions suitable for utils directory

### Hook Types (types/hooks.ts)

**Purpose**: Type definitions for hook system  
**Location**: `packages/agent-sdk/src/types/hooks.ts`

```typescript
export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"
export interface HookCommand { type: "command"; command: string }
export interface HookEventConfig { matcher?: string; hooks: HookCommand[] }
export interface HookConfiguration { hooks: Partial<Record<HookEvent, HookEventConfig[]>> }
export interface HookExecutionContext { event: HookEvent; toolName?: string; projectDir: string; timestamp: Date }
export interface HookExecutionResult { success: boolean; exitCode?: number; stdout?: string; stderr?: string; duration: number; timedOut: boolean }
// ... additional type definitions
```

**Re-exports**: Main types.ts will re-export hook types for external consumers

## Entity Relationships

```
HookManager (managers/)
├─ uses HookMatcher (utils/) for pattern matching
├─ uses Hook services (services/) for execution and configuration
└─ manages HookConfiguration state

Hook Services (services/)
├─ uses HookTypes for context and result structures
├─ execution functions: isolated process execution
└─ settings functions: file system I/O operations

HookMatcher (utils/)
└─ pure utility functions (no dependencies on other hook components)

Hook Types (types/)
└─ shared type definitions across all components
```

## File Structure Mapping

### Source Files
```
Current Location                    → New Location
src/hooks/manager.ts               → src/managers/hookManager.ts
src/hooks/executor.ts              → src/services/hook.ts (consolidated)
src/hooks/matcher.ts               → src/utils/hookMatcher.ts
src/hooks/settings.ts              → src/services/hook.ts (consolidated)
src/hooks/types.ts                 → src/types/hooks.ts
src/types.ts                       → src/types/index.ts
```

### Test Files
```
Current Location                    → New Location
tests/hooks/manager.test.ts        → tests/managers/hookManager.test.ts
tests/hooks/executor.test.ts       → tests/services/hook.test.ts (consolidated)
tests/hooks/matcher.test.ts        → tests/utils/hookMatcher.test.ts
tests/hooks/settings.test.ts       → tests/services/hook.test.ts (consolidated)
tests/hooks/types.test.ts          → tests/types/hooks.test.ts
```

## Data Integrity Constraints

### Functional Constraints
- All existing hook functionality must remain identical
- Hook execution results must maintain same structure and timing
- Configuration loading behavior must be preserved
- Pattern matching logic must remain unchanged

### Type Safety Constraints  
- All TypeScript interfaces must remain compatible
- Export signatures must match current public API
- Import paths must resolve correctly after refactoring
- No `any` types introduced during refactoring

### Testing Constraints
- All existing test cases must pass without modification (except imports)
- Test coverage must remain at current levels
- Test isolation must be maintained
- No test logic changes required

## Validation Rules

### Import Resolution
- All internal imports must reference new file locations
- External imports from other packages must continue to work
- Type imports must resolve through new types/ structure
- No circular dependencies introduced

### Export Compatibility
- Main package index.ts removes hooks/* export
- Individual components exportable from new locations
- Type definitions available through types/hooks.ts
- Function signatures match current interface contracts

### Directory Structure
- src/hooks/ directory completely removed
- tests/hooks/ directory completely removed  
- New files follow Constitution VII organization patterns
- Test structure mirrors source structure exactly