# Implementation Plan: Hook Output Support

**Branch**: `012-hook-output-support` | **Date**: 2025-11-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-hook-output-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement both simple exit code communication and advanced JSON output control for hooks, enabling fine-grained control over Wave's behavior including conditional blocking, custom messages, operation modifications, and UI components for warning blocks, hook type blocks, and user confirmation dialogs. Uses **Promise-based permission handling** where hooks can request user confirmation through Promises that the UI resolves, allowing sendMessage execution to continue naturally without complex pause/resume mechanisms.

## Technical Context

**Language/Version**: TypeScript 5.9+ (based on package.json and existing codebase)  
**Primary Dependencies**: @modelcontextprotocol/sdk, openai, vitest for testing  
**Storage**: JSON session files in ~/.wave/sessions/ (based on existing hook JSON input support)  
**Testing**: Vitest with real hook execution using temporary directories, jq for JSON parsing validation  
**Target Platform**: Node.js 16+ cross-platform CLI application  
**Project Type**: Monorepo with agent-sdk package providing core functionality and code package providing CLI interface  
**Performance Goals**: Hook output processing <100ms overhead, JSON validation <50ms per hook, Promise-based permission resolution with no sendMessage execution blocking  
**Constraints**: Must maintain backward compatibility with existing hooks, no breaking changes to hook execution model, uses Promise-based async patterns instead of complex state management  
**Scale/Scope**: Support for 4 hook event types (PreToolUse, PostToolUse, UserPromptSubmit, Stop), comprehensive exit code and JSON output handling, Promise-based user permission requests without execution interruption

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Implementation extends existing agent-sdk package with hook output processing functionality, maintaining clear package boundaries. No new packages required. Agent-sdk provides core functionality; code package provides CLI interface. No circular dependencies introduced.

✅ **II. TypeScript Excellence**: All new code uses strict TypeScript with comprehensive type definitions for hook output structures, JSON schemas, and message block types. No `any` types used in contracts or data models. Runtime validation matches TypeScript interfaces.

✅ **III. Test Alignment**: Tests organized in packages/agent-sdk/tests/ with integration tests using temporary directories and real hook execution (following existing pattern), unit tests with mocking for hook output parsing logic. Using Vitest as testing framework, HookTester for React hooks where applicable.

✅ **IV. Build Dependencies**: After modifying agent-sdk types and utilities, will run `pnpm build` before testing in dependent packages. Using `pnpm` exclusively for package management throughout implementation.

✅ **V. Documentation Minimalism**: No additional markdown documentation beyond spec requirements (research, data-model, contracts, quickstart). Focus on clear code and inline documentation rather than separate docs.

✅ **VI. Quality Gates**: Will run `pnpm run type-check` and `pnpm run lint` after all modifications to ensure code quality. All type checking must pass without errors or warnings. All linting rules must be satisfied.

✅ **VII. Source Code Structure**: Hook output logic organized according to constitution patterns:
- Hook output parsing utilities → `utils/` (pure functions)
- Hook execution services → `services/` (existing hook executor extensions) 
- Message block types → `types/messaging.ts` (cross-file type definitions)
- UI components → `packages/code/src/components/` (UI layer)
- Hook-related contexts → `packages/code/src/contexts/` (global state and logic)

**GATE STATUS**: ✅ PASS - All constitutional requirements satisfied without violations. Post-design evaluation confirms compliance with all principles.

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
├── agent-sdk/
│   ├── src/
│   │   ├── types/
│   │   │   ├── messaging.ts          # Add WarnBlock, HookBlock types
│   │   │   └── hooks.ts              # Hook output result types, JSON schemas, Promise-based PermissionRequest  
│   │   ├── utils/
│   │   │   ├── convertMessagesForAPI.ts  # Add warn/hook block conversion logic
│   │   │   └── hookOutputParser.ts   # NEW: Parse hook exit codes and JSON output with Promise-based permissions
│   │   ├── services/
│   │   │   └── hookExecutor.ts       # Existing: Extend with Promise-based permission handling
│   │   └── managers/
│   │       └── messageManager.ts     # Add addWarnMessage, addHookMessage methods
│   ├── examples/
│   │   ├── exit-code-communication.ts    # NEW: User Story 1 - Exit codes (0, 2, other) testing
│   │   ├── json-output-control.ts        # NEW: User Story 2 - JSON with continue, stopReason, systemMessage
│   │   ├── pretooluse-permissions.ts     # NEW: User Story 3 - Permission decisions (allow/deny/ask) + input modification
│   │   ├── posttooluse-feedback.ts       # NEW: User Story 4 - Automated feedback and context injection
│   │   └── prompt-stop-control.ts        # NEW: User Story 5 - UserPromptSubmit and Stop event control
│   └── tests/
│       ├── utils/hookOutputParser.test.ts    # NEW: Test exit code/JSON parsing with Promise resolution
│       ├── services/hookExecutor.test.ts     # Existing: Extend with Promise-based permission tests  
│       └── integration/hookOutput.test.ts    # NEW: End-to-end hook output tests with Promise patterns
└── code/
    └── src/
        ├── components/
        │   ├── WarnBlock.tsx         # NEW: Warning message UI component
        │   ├── HookBlock.tsx         # NEW: Hook type block UI component  
        │   └── ConfirmDialog.tsx     # NEW: User confirmation dialog with Promise resolution
        ├── contexts/
        │   └── hookContext.tsx       # NEW: Hook state management with Promise-based permissions
        └── hooks/
            └── useHookOutput.ts      # NEW: React hook for Promise-based hook output processing
```

**Structure Decision**: Extends existing monorepo structure with hook output functionality distributed across appropriate directories per constitution VII. Uses Promise-based permission handling instead of complex pause/resume mechanisms for cleaner async flow. **Critical addition: Real-world examples in packages/agent-sdk/examples/ for comprehensive testing of this complex feature** - five examples directly map to the five user stories from spec.md: exit-code-communication.ts (Story 1), json-output-control.ts (Story 2), pretooluse-permissions.ts (Story 3), posttooluse-feedback.ts (Story 4), prompt-stop-control.ts (Story 5). Edge cases like malformed JSON and validation conflicts will be covered in unit tests. New UI components in code package, core logic in agent-sdk package maintaining clear separation between SDK and CLI interface.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

