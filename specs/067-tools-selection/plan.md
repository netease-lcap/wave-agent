# Implementation Plan: Tools Selection

**Branch**: `067-tools-selection` | **Date**: 2026-02-25 | **Spec**: [./spec.md]
**Input**: Feature specification from `./spec.md`

## Summary

The primary requirement is to allow users to control which tools are available to the agent in a CLI session using a `--tools` flag. This will be implemented by adding a `tools` property to the `AgentOptions` in the `agent-sdk` and updating the `ToolManager` to filter built-in tools and plugins based on this list. The CLI will parse the `--tools` flag and pass the resulting tool names to the SDK.

## Technical Context

**Language/Version**: TypeScript 5.x  
**Primary Dependencies**: `yargs` (CLI parsing), `agent-sdk` (core logic)  
**Storage**: N/A  
**Testing**: Vitest (unit and integration tests)  
**Target Platform**: Node.js (CLI)
**Project Type**: pnpm monorepo (packages: `agent-sdk`, `code`)  
**Performance Goals**: Minimal overhead for tool filtering at initialization.  
**Constraints**: Must maintain backward compatibility (default behavior).  
**Scale/Scope**: Small feature affecting CLI and SDK initialization.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Changes are split between `agent-sdk` (core logic) and `code` (CLI interface).
- [x] **TypeScript Excellence**: All new properties and methods will be strictly typed.
- [x] **Test Alignment**: Unit tests for `ToolManager` filtering and integration tests for CLI flag parsing are required.
- [x] **Build Dependencies**: `agent-sdk` must be built before testing `code`.
- [x] **Documentation Minimalism**: No extra markdown files created beyond the required spec/plan artifacts.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` will be run.
- [x] **Source Code Structure**: Follows existing patterns in `agent-sdk` (managers) and `code` (contexts/hooks).
- [x] **Test-Driven Development**: Critical filtering logic in `ToolManager` will be developed with tests.
- [x] **Type System Evolution**: `AgentOptions` and `ToolManagerOptions` will be extended.
- [x] **Data Model Minimalism**: Simple `string[]` for tool names.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning.
- [x] **User-Centric Quickstart**: `quickstart.md` created for CLI/SDK users.

### User Story 4 - Print Mode Tool Selection (Priority: P2)

The `--print` (or `-p`) option in the CLI will also support the `--tools` flag, ensuring that the agent's toolset can be restricted even when running in non-interactive print mode.

## Project Structure

### Documentation (this feature)

```
specs/067-tools-selection/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
│   └── api.md           # API contracts
└── tasks.md             # Phase 2 output (to be created)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── agent.ts             # Update AgentOptions and Agent.create
│       └── managers/
│           ├── toolManager.ts   # Implement tool filtering logic
│           ├── aiManager.ts     # Remove tools arg from sendAIMessage
│           └── subagentManager.ts # Use PermissionManager to deny Agent tool
└── code/
    └── src/
        ├── index.ts             # Add --tools flag to yargs
        ├── cli.tsx              # Update startCli and CliOptions
        ├── App.tsx              # Pass tools prop
        └── contexts/
            └── useChat.tsx      # Pass tools to Agent.create
```

**Structure Decision**: Standard pnpm monorepo structure as defined in the constitution.

## Complexity Tracking

*No violations detected.*
