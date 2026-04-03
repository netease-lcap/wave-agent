# Implementation Plan: Hooks Support

**Branch**: `005-hooks` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-hooks/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement a hooks system for Wave Code that allows users to configure automated actions at specific points in the AI workflow. The system will support PreToolUse, PostToolUse, UserPromptSubmit, and Stop hooks with configurable commands that execute at user-level and project-level settings. This enables automated code quality checks, prompt validation, and post-processing workflows. 

Additionally, hooks receive structured JSON data via stdin containing session information and event-specific data for enhanced context.

The system also supports exit code based communication patterns (Hook Exit Code Output Support). The system interprets hook exit codes (0=success, 2=blocking error for UserPromptSubmit only, other=non-blocking error) and handles stdout/stderr appropriately based on hook type and exit code. This involves extending the existing hook manager and message manager (including adding `removeLastUserMessage()` method) to process hook execution results and inject appropriate messages into the agent's conversation flow.

## Technical Context

**Language/Version**: TypeScript 5.9+ with Node.js 16+  
**Primary Dependencies**: wave-agent-sdk (workspace), React 19.1, Ink 6.0, yargs 17.7, openai for API types  
**Storage**: JSON configuration files (~/.wave/settings.json, .wave/settings.json), Session-based message storage in ~/.wave/sessions (existing)  
**Testing**: Vitest 3.2+ with ink-testing-library for CLI components, Vitest with mocking for hook execution in agent-sdk  
**Target Platform**: Cross-platform CLI (Linux, macOS, Windows)
**Project Type**: Monorepo with agent-sdk core and code CLI interface  
**Performance Goals**: Hook execution <10s, minimal impact on main workflow <1s delay, Hook output processing within 200ms, blocking decisions within 100ms  
**Constraints**: Non-blocking hook execution, isolated process execution, cross-platform compatibility, maintain backward compatibility with existing hooks  
**Scale/Scope**: Support multiple hooks per event, regex pattern matching, environment variable injection, enhancement to existing hook system affecting ~10 hook-related files in agent-sdk package

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Package-First Architecture**: Hooks functionality implemented in agent-sdk with CLI interface in code package, maintaining clear boundaries. Enhancement stays within existing agent-sdk package boundaries.

✅ **TypeScript Excellence**: All code uses strict TypeScript without any types, comprehensive type definitions created for hook configurations and events. Comprehensive type contracts defined for all hook output processing.

✅ **Test Alignment**: Tests follow structure - agent-sdk/tests/hooks/ for unit tests, agent-sdk/examples/ for integration tests with real hook execution. Agent tests in `packages/agent-sdk/tests/agent/` following feature-based organization use full mocking to avoid real operations.

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

```
# Monorepo structure
packages/
├── agent-sdk/                 # Core hooks system
│   ├── src/
│   │   ├── managers/
│   │   │   ├── hookManager.ts    # HookManager class (Enhanced: hook result processing logic)
│   │   │   ├── aiManager.ts      # Integration (Enhanced: process PreToolUse/PostToolUse/Stop hook results)
│   │   │   └── messageManager.ts # Enhanced: add removeLastUserMessage() method
│   │   ├── services/
│   │   │   └── hook.ts           # Consolidated hook services (Execution & Settings)
│   │   ├── utils/
│   │   │   ├── hookMatcher.ts    # Pattern matching utility
│   │   │   └── messageOperations.ts # Enhanced: add removeLastUserMessage utility function
│   │   ├── types/
│   │   │   └── hooks.ts          # Hook type definitions
│   │   └── agent.ts              # Integration (Enhanced: process UserPromptSubmit hook results)
│   ├── tests/
│   │   ├── managers/
│   │   │   └── hookManager.test.ts
│   │   ├── services/
│   │   │   └── hook.test.ts
│   │   ├── utils/
│   │   │   └── hookMatcher.test.ts
│   │   ├── types/
│   │   │   └── hooks.test.ts
│   │   └── agent/
│   │       └── hooks-exitcode-output/  # New: comprehensive test suite with full mocking
│   │           ├── hook-success.test.ts
│   │           ├── hook-blocking-errors.test.ts
│   │           └── hook-non-blocking-errors.test.ts
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
