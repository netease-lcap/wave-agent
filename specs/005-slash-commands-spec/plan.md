# Implementation Plan: Custom Slash Commands

**Branch**: `005-slash-commands-spec` | **Date**: December 19, 2024 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-slash-commands-spec/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Custom slash commands allow users to create reusable AI workflow templates by placing markdown files in `.wave/commands/` directories. The system automatically discovers, loads, and executes these commands with parameter substitution support (`$ARGUMENTS`, `$1`, `$2`, etc.), YAML frontmatter configuration, and bash command execution capabilities. Implementation includes a TypeScript-based SlashCommandManager in the agent-sdk package and React-based CommandSelector UI in the code package, with full integration into the existing chat interface.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.x with strict type checking  
**Primary Dependencies**: Node.js, React (Ink for CLI), YAML parsing (gray-matter), file system operations  
**Storage**: File system based - markdown files in `.wave/commands/` directories  
**Testing**: Vitest with HookTester for React hooks, temporary directories for integration tests  
**Target Platform**: Cross-platform Node.js CLI application
**Project Type**: Monorepo with packages (agent-sdk core + code CLI interface)  
**Performance Goals**: Command loading <200ms, parameter substitution <5ms, UI responsiveness <100ms  
**Constraints**: Zero external API dependencies, filesystem-only storage, backward compatibility  
**Scale/Scope**: Support 50+ concurrent custom commands, infinite parameter combinations, dual-scope (user/project)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**✅ I. Package-First Architecture**: Feature properly organized across agent-sdk (core) and code (UI) packages with clear boundaries

**✅ II. TypeScript Excellence**: All code written in TypeScript with strict typing, comprehensive type definitions for SlashCommand interfaces

**✅ III. Test Alignment**: Tests organized in `packages/*/tests` with unit tests (mocking) and integration tests (temporary directories)

**✅ IV. Build Dependencies**: agent-sdk must be built before testing in code package, using pnpm exclusively

**✅ V. Documentation Minimalism**: No additional markdown docs created, relying on code clarity and inline documentation

**✅ VI. Quality Gates**: TypeScript compilation and linting must pass - already implemented and tested

**STATUS**: ✅ All gates pass - feature aligns with constitution

**Post-Phase 1 Re-evaluation**:
- ✅ **Package-First Architecture**: Data model and contracts confirm clean package boundaries
- ✅ **TypeScript Excellence**: Interface definitions demonstrate comprehensive typing with no `any` usage
- ✅ **Test Alignment**: Existing tests follow prescribed patterns with proper unit/integration separation
- ✅ **Build Dependencies**: Quickstart guide correctly documents build-then-test workflow
- ✅ **Documentation Minimalism**: Generated artifacts are for planning only, no user-facing docs created
- ✅ **Quality Gates**: All existing code passes type-check and lint requirements

**Final Status**: ✅ **APPROVED** - Implementation fully complies with Wave Agent Constitution

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
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── slashCommandManager.ts    # Core orchestration logic
│   ├── utils/
│   │   ├── customCommands.ts         # File discovery and loading
│   │   ├── commandArgumentParser.ts  # Parameter substitution
│   │   └── markdownParser.ts         # YAML frontmatter parsing
│   ├── types.ts                      # SlashCommand, CustomSlashCommand interfaces
│   └── agent.ts                      # Integration point
├── tests/
│   ├── managers/
│   │   └── slashCommandManager.test.ts
│   ├── utils/
│   │   ├── customCommands.test.ts
│   │   └── commandArgumentParser.test.ts
│   └── agent/
│       └── agent.abort.test.ts
└── examples/
    └── custom-slash-command.ts       # Usage demonstration

packages/code/
├── src/
│   ├── components/
│   │   ├── CommandSelector.tsx       # Interactive command picker
│   │   ├── InputBox.tsx             # Integration with input
│   │   └── ChatInterface.tsx        # Main UI coordination
│   ├── hooks/
│   │   └── useCommandSelector.ts    # Command selection logic
│   └── contexts/
│       └── useChat.tsx              # State management
└── tests/
    └── components/
        ├── InputBox.slashCommand.test.tsx
        └── CommandSelector.test.tsx
```

**Structure Decision**: Monorepo package-based architecture selected to maintain clear separation of concerns. Core logic resides in `agent-sdk` package for reusability, while UI components live in `code` package for CLI-specific presentation. This aligns with existing Wave Agent architecture and enables independent testing and deployment of each package.

## Complexity Tracking

*No violations detected - feature fully complies with constitution*

