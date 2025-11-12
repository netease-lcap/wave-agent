# Implementation Plan: Refactor Hooks System File Structure

**Branch**: `009-refactor-hooks-structure` | **Date**: 2025-11-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-refactor-hooks-structure/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Refactor the Wave Agent SDK hooks system file structure to align with Constitution VII Source Code Structure principles. Move hook executor to services as functions, hook manager to managers, utilities to utils, reorganize types, and align test files with source structure. Complete removal of src/hooks and tests/hooks directories while maintaining all functionality and updating import paths.

## Technical Context

**Language/Version**: TypeScript with strict type checking enabled  
**Primary Dependencies**: Node.js child_process, minimatch, fs/path modules  
**Storage**: File system operations for hook configuration loading  
**Testing**: Vitest 3.2.4, HookTester for React hooks  
**Target Platform**: Node.js monorepo environment  
**Project Type**: Monorepo package refactoring  
**Performance Goals**: No performance impact, maintain existing hook execution times  
**Constraints**: No breaking changes to hook functionality, all existing tests must pass  
**Scale/Scope**: 5 source files + 5 test files → 4 source files + 4 test files + import path updates across codebase

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle Compliance Analysis

- ✅ **I. Package-First Architecture**: Changes within single package (agent-sdk), no cross-package dependencies affected
- ✅ **II. TypeScript Excellence**: Strict typing maintained, no `any` types introduced
- ✅ **III. Test Alignment**: Test files will mirror source structure per constitution requirement
- ✅ **IV. Build Dependencies**: Will run `pnpm build` after agent-sdk modifications
- ✅ **V. Documentation Minimalism**: No new documentation files created
- ✅ **VI. Quality Gates**: Will run type-check and lint after all changes
- ✅ **VII. Source Code Structure**: Core purpose - aligning with managers/services/utils organization

**Gate Status**: ✅ PASS - All constitutional principles satisfied

## Project Structure

### Documentation (this feature)

```
specs/009-refactor-hooks-structure/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── hookManager.ts         # Moved from hooks/manager.ts
│   ├── services/
│   │   └── hook.ts                # Consolidated from hooks/executor.ts + hooks/settings.ts
│   ├── utils/
│   │   └── hookMatcher.ts         # Moved from hooks/matcher.ts
│   ├── types/
│   │   ├── index.ts               # Renamed from types.ts
│   │   └── hooks.ts               # Moved from hooks/types.ts
│   └── index.ts                   # Updated exports (remove hooks/*)
└── tests/
    ├── managers/
    │   └── hookManager.test.ts    # Moved from hooks/manager.test.ts
    ├── services/
    │   └── hook.test.ts           # Consolidated from hooks/executor.test.ts + hooks/settings.test.ts
    ├── utils/
    │   └── hookMatcher.test.ts    # Moved from hooks/matcher.test.ts
    └── types/
        └── hooks.test.ts          # Moved from hooks/types.test.ts

# Directories to be removed:
# - packages/agent-sdk/src/hooks/ (entire directory)
# - packages/agent-sdk/tests/hooks/ (entire directory)
```

**Structure Decision**: Monorepo package refactoring following Constitution VII patterns. Primary changes within agent-sdk package with hooks components distributed to their logical architectural locations: managers for state logic, services for IO operations (consolidated into single hook.ts module), utils for pure functions, and types reorganized for better cross-file usage.

## Complexity Tracking

*No constitutional violations requiring justification*