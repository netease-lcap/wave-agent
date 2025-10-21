# Implementation Plan: Hooks Support

**Branch**: `001-hooks-support` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-hooks-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement a hooks system for Wave Code that allows users to configure automated actions at specific points in the AI workflow. The system will support PreToolUse, PostToolUse, UserPromptSubmit, and Stop hooks with configurable commands that execute at user-level and project-level settings. This enables automated code quality checks, prompt validation, and post-processing workflows.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9+ with Node.js 16+  
**Primary Dependencies**: wave-agent-sdk (workspace), React 19.1, Ink 6.0, yargs 17.7  
**Storage**: JSON configuration files (~/.wave/settings.json, .wave/settings.json)  
**Testing**: Vitest 3.2+ with ink-testing-library for CLI components  
**Target Platform**: Cross-platform CLI (Linux, macOS, Windows)
**Project Type**: Monorepo with agent-sdk core and code CLI interface  
**Performance Goals**: Hook execution <10s, minimal impact on main workflow <1s delay  
**Constraints**: Non-blocking hook execution, isolated process execution, cross-platform compatibility  
**Scale/Scope**: Support multiple hooks per event, regex pattern matching, environment variable injection

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Package-First Architecture**: Hooks functionality implemented in agent-sdk with CLI interface in code package, maintaining clear boundaries. No circular dependencies created.

✅ **TypeScript Excellence**: All code uses strict TypeScript without any types, comprehensive type definitions created for hook configurations and events in contracts/hooks-api.md.

✅ **Test Alignment**: Tests follow structure - agent-sdk/tests/hooks/ for unit tests, agent-sdk/examples/ for integration tests with real hook execution. Mirror source structure exactly.

✅ **Build Dependencies**: Changes to agent-sdk will require pnpm build before testing in code package. Hook system integrates with existing build process.

✅ **Documentation Minimalism**: No new markdown files created beyond required spec artifacts. Focus on inline documentation and comprehensive type definitions in contracts.

**Post-Phase 1 Validation**: All constitution requirements met. Hook system design maintains monorepo principles and existing development workflows.

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
# Monorepo structure (chosen for Wave Code)
packages/
├── agent-sdk/                 # Core hooks system
│   ├── src/
│   │   ├── hooks/            # Hook system implementation
│   │   │   ├── manager.ts    # HookManager class
│   │   │   ├── executor.ts   # Hook execution logic
│   │   │   ├── matcher.ts    # Pattern matching
│   │   │   └── types.ts      # Hook type definitions
│   │   ├── services/         # Existing services
│   │   └── agent.ts          # Integration points
│   ├── tests/
│   │   └── hooks/            # Unit tests for hooks
│   └── examples/
│       └── hooks/            # Integration tests
└── code/                     # CLI interface
    ├── src/
    │   ├── components/       # Existing CLI components  
    │   ├── contexts/         # Existing contexts
    │   └── utils/            # Existing utilities
    └── tests/
        └── components/       # Existing CLI component tests
```

**Structure Decision**: Selected monorepo structure to align with existing Wave Code architecture. Hooks core functionality implemented in agent-sdk package with CLI integration in code package, following the established package-first architecture principle.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

