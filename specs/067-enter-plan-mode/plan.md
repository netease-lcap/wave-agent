# Implementation Plan: Enter Plan Mode

**Branch**: `067-enter-plan-mode` | **Date**: 2026-02-13 | **Spec**: `./spec.md`

## Summary

The goal is to implement the `EnterPlanMode` tool in the `agent-sdk` package. This tool will allow the agent to explicitly request user permission to transition into a "plan mode" state for complex tasks. The implementation will leverage the existing `PermissionMode` and `PlanManager` infrastructure to ensure a safe, read-only design phase that requires user sign-off before any code is modified.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`, `code` (CLI)
**Storage**: Files (temporary plan files in `~/.wave/plans/`)
**Testing**: Vitest
**Target Platform**: Node.js (CLI)
**Project Type**: Monorepo (pnpm)
**Performance Goals**: Instant transition to plan mode (<100ms)
**Constraints**: Must maintain read-only restrictions in plan mode.
**Scale/Scope**: Core tool for agent-user interaction.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Package-First Architecture**: ✅ Tool implemented in `agent-sdk`, used by `code`.
- **II. TypeScript Excellence**: ✅ Strict typing for tool config and execution.
- **III. Test Alignment**: ✅ Unit tests for the tool and integration tests for the mode transition.
- **IV. Build Dependencies**: ✅ `pnpm build` required after `agent-sdk` changes.
- **V. Documentation Minimalism**: ✅ Only necessary spec/plan/quickstart files created.
- **VI. Quality Gates**: ✅ `type-check`, `lint`, and `test:coverage` will be run.
- **VII. Source Code Structure**: ✅ Tool placed in `src/tools/`, registered in `ToolManager`.
- **VIII. Test-Driven Development**: ✅ Tests will be written alongside implementation.
- **IX. Type System Evolution**: ✅ Reuses existing `PermissionMode` types.
- **X. Data Model Minimalism**: ✅ Minimal state tracking for plan mode.
- **XI. Planning and Task Delegation**: ✅ General-purpose agent used for planning.
- **XII. User-Centric Quickstart**: ✅ `quickstart.md` focused on CLI user experience.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/067-enter-plan-mode/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
│   └── enter-plan-mode.md
└── tasks.md             # Phase 2 output (to be created)
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── constants/
│   │   └── tools.ts       # Register tool name
│   ├── managers/
│   │   └── toolManager.ts # Register tool plugin
│   └── tools/
│       └── enterPlanMode.ts # Tool implementation
└── tests/
    └── tools/
        └── enterPlanMode.test.ts # Unit tests

packages/code/
└── tests/
    └── integration/
        └── enterPlanMode.feature.test.ts # Integration tests
```

**Structure Decision**: Monorepo structure with tool implementation in `agent-sdk` and integration tests in `code`.


## Technical Decision: Instruction Placement
- **Tool Description**: Concise summary for triggering.
- **System Prompt**: Detailed "PLANNING_POLICY" for behavioral guidance.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

