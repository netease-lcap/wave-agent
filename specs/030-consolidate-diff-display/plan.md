# Implementation Plan: Consolidate Diff Display

**Branch**: `030-consolidate-diff-display` | **Date**: 2025-12-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/030-consolidate-diff-display/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Remove separate DiffViewer component and consolidate diff display functionality directly into ToolResultDisplay. Agent-sdk will export a transformation function to convert ToolBlock to Change[] array, keeping UI layer clean from tool parameter knowledge. Display unlimited diffs in the confirmation dialog and in the tool results display (only after completion).

## Technical Context

**Language/Version**: TypeScript (existing project)  
**Primary Dependencies**: React, Ink (existing UI framework), diff library (move from agent-sdk to code package)  
**Storage**: N/A (parameter-based diff display only)  
**Testing**: Vitest (existing testing framework)  
**Target Platform**: CLI application (existing)
**Project Type**: Monorepo packages (existing structure)  
**Performance Goals**: Unlimited diff display for simplicity, no line limits or pagination  
**Constraints**: Match existing DiffViewer.tsx color scheme exactly, no interface changes to agent-sdk  
**Scale/Scope**: All diff sizes displayed completely, case-by-case parameter transformation in component

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**I. Package-First Architecture**: ✅ **PASS** - Works within existing `packages/code/src/components` structure, no new packages needed

**II. TypeScript Excellence**: ✅ **PASS** - Will maintain existing TypeScript strict typing, extending existing interfaces (DiffData, DiffEntry added to agent-sdk)

**III. Test Alignment**: ✅ **PASS** - Tests will be in `packages/code/tests/components` following existing pattern, updating existing ToolResultDisplay tests

**IV. Build Dependencies**: ✅ **PASS** - Will need to build agent-sdk after adding transformation function export

**V. Documentation Minimalism**: ✅ **PASS** - No new documentation files created, only planning artifacts per specification process

**VI. Quality Gates**: ✅ **PASS** - Will run `pnpm run type-check` and `pnpm lint` after implementation

**VII. Source Code Structure**: ✅ **PASS** - Working within existing `packages/code/src/components` structure, removing DiffViewer component

**VIII. Test-Driven Development**: ✅ **PASS** - Will test essential diff display behavior and tool parameter handling in existing test structure

**IX. Type System Evolution**: ✅ **PASS** - No new types or interfaces created, using existing ToolBlock as-is with case-by-case transformation logic

**X. Data Model Minimalism**: ✅ **PASS** - No new persistent entities created, using ephemeral parameter transformation within component logic

**Overall Status**: ✅ **PASS** - No constitutional violations identified. Simplified approach with no interface changes, unlimited display, and exact color matching follows constitution principles maximally.

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/                    # Core SDK (ADD transformation function export)
│   ├── src/
│   │   ├── types.ts             # Add Change interface, keep ToolBlock unchanged
│   │   ├── utils/
│   │   │   └── diff-transform.ts # NEW: Export transformToolBlockToChanges()
│   │   └── ...
│   └── tests/
├── code/                        # CLI interface (ADD diff package dependency)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ToolResultDisplay.tsx    # Main integration target + diff logic (only for "end" stage)
│   │   │   ├── Confirmation.tsx         # Render diff display for user approval
│   │   │   ├── DiffDisplay.tsx          # Consolidated diff display component
│   │   │   ├── DiffViewer.tsx           # TO BE REMOVED
│   │   │   └── MessageItem.tsx          # Remove diff rendering logic
│   │   └── ...
│   ├── package.json             # Add diff package dependency here
│   └── tests/
│   │   └── components/
│   │       └── ToolResultDisplay.test.tsx  # Updated tests
└── ...
```

**Structure Decision**: Working within existing Wave Agent monorepo structure. Agent-sdk will export a transformation function to convert ToolBlock to Change[] array, maintaining clean separation between tool logic (agent-sdk) and presentation logic (code package). Move diff package dependency from agent-sdk to code package where the actual diff rendering occurs.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

