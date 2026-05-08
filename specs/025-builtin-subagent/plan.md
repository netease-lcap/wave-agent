# Implementation Plan: Built-in Subagent Support

**Branch**: `025-builtin-subagent` | **Date**: 2025-12-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-builtin-subagent/spec.md`

## Summary

Add built-in subagent support to load hardcoded subagent configurations (starting with "Explore" agent) directly from source code rather than external files, enabling immediate access to specialized agents without user configuration.

## Technical Context

**Language/Version**: TypeScript with Node.js (existing project)  
**Primary Dependencies**: Existing SubagentManager, subagentParser utilities  
**Storage**: In-memory hardcoded configurations (no external storage)  
**Testing**: Vitest (existing framework)  
**Target Platform**: Cross-platform CLI tool  
**Project Type**: Monorepo with packages  
**Performance Goals**: Same as existing subagent loading (<500ms selection time)  
**Constraints**: Must integrate with existing SubagentManager without breaking changes  
**Scale/Scope**: Initially 1 built-in agent (Explore), extensible for more

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Changes isolated to `agent-sdk` package, no new packages needed  
✅ **II. TypeScript Excellence**: All new code will use strict TypeScript  
✅ **III. Test Alignment**: Tests will be in `packages/agent-sdk/tests/`  
✅ **IV. Build Dependencies**: Will run `pnpm build` after `agent-sdk` changes  
✅ **V. Documentation Minimalism**: No new documentation files created  
✅ **VI. Quality Gates**: Will run type-check and lint before completion  
✅ **VII. Source Code Structure**: Following existing `utils/` pattern for built-in definitions  
✅ **VIII. Test-Driven Development**: Essential testing for built-in loading functionality  
✅ **IX. Type System Evolution**: Will extend existing `SubagentConfiguration` interface  
✅ **X. Data Model Minimalism**: Reusing existing `SubagentConfiguration` without extensions

## Project Structure

### Documentation (this feature)

```
specs/025-builtin-subagent/
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
│   ├── utils/
│   │   ├── subagentParser.ts        # Extend to load built-ins
│   │   └── builtinSubagents.ts      # New: Built-in definitions
│   └── managers/
│       └── subagentManager.ts       # No changes needed
└── tests/
    └── utils/
        ├── subagentParser.test.ts   # Extend existing tests
        └── builtinSubagents.test.ts # New: Test built-in loading
```

**Structure Decision**: Minimal changes to existing codebase. New `builtinSubagents.ts` contains hardcoded definitions. Extend `subagentParser.ts` to include built-ins in loading process. No changes to SubagentManager interface.

## Complexity Tracking

*No Constitution violations identified.*