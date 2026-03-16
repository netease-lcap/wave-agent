# Implementation Plan: Status Command

**Branch**: `069-status-command` | **Date**: 2026-02-27 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `./spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The goal is to add a `/status` command to the Wave CLI that displays current session metadata, including the version, session ID, current working directory, Wave base URL, and active AI model. This will be implemented as a local CLI command that triggers a React Ink overlay component.

Research has confirmed that all necessary metadata is accessible from the `Agent` instance, and the UI can be implemented using the existing overlay pattern in `packages/code`.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22+
**Primary Dependencies**: React 19, Ink 6, wave-agent-sdk
**Storage**: N/A (reads from memory and configuration)
**Testing**: Vitest
**Target Platform**: CLI (Linux/macOS/Windows)
**Project Type**: Monorepo (packages/code, packages/agent-sdk)
**Performance Goals**: Instant display of status information (<100ms)
**Constraints**: Must handle long paths gracefully; must be dismissible with Esc; input box must be hidden when status is shown.
**Scale/Scope**: Small feature addition to the CLI interface.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Feature is split between `agent-sdk` (data retrieval) and `code` (UI).
- [x] **TypeScript Excellence**: Strict typing will be used for all new components and logic.
- [x] **Test Alignment**: Unit tests for the new component and integration tests for command handling.
- [x] **Build Dependencies**: `agent-sdk` will be built before testing `code`.
- [x] **Documentation Minimalism**: No extra markdown docs except those required by the spec.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` will be run.
- [x] **Source Code Structure**: Follows existing patterns in `packages/code/src/components` and `packages/code/src/managers`.
- [x] **Test-Driven Development**: Tests will be written alongside implementation.
- [x] **Type System Evolution**: Existing types will be extended if necessary.
- [x] **Data Model Minimalism**: Only essential session metadata will be displayed.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning; subagents for implementation.
- [x] **User-Centric Quickstart**: `quickstart.md` will focus on how to use the `/status` command.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/069-status-command/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       └── services/
│           └── session.ts       # Session metadata retrieval
└── code/
    └── src/
        ├── components/
        │   └── StatusCommand.tsx # New UI component
        ├── managers/
        │   └── InputManager.ts   # Command handling logic
        └── hooks/
            └── useInputManager.ts # State management
```

**Structure Decision**: Monorepo structure with UI in `packages/code` and core logic in `packages/agent-sdk`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

