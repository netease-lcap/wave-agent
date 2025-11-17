# Implementation Plan: Hook Exit Code Output Support

**Branch**: `011-hooks-exitcode-output` | **Date**: 2025-11-17 | **Spec**: [specs/011-hooks-exitcode-output/spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-hooks-exitcode-output/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enhance the Wave Agent hooks system to support exit code based communication patterns. The system must interpret hook exit codes (0=success, 2=blocking error for UserPromptSubmit only, other=non-blocking error) and handle stdout/stderr appropriately based on hook type and exit code. Core implementation involves extending the existing hook manager and message manager (including adding `removeLastUserMessage()` method) to process hook execution results and inject appropriate messages into the agent's conversation flow.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+  
**Primary Dependencies**: Existing agent-sdk architecture, vitest for testing, openai for API types  
**Storage**: Session-based message storage in ~/.wave/sessions (existing)  
**Testing**: Vitest with mocking for hook execution, temporary directories for integration tests  
**Target Platform**: Cross-platform Node.js CLI application  
**Project Type**: Monorepo package enhancement (agent-sdk package modification)  
**Performance Goals**: Hook output processing within 200ms, blocking decisions within 100ms  
**Constraints**: Must maintain backward compatibility with existing hooks, no breaking changes to current interfaces  
**Scale/Scope**: Enhancement to existing hook system affecting ~10 hook-related files in agent-sdk package

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Package-First Architecture**: Enhancement stays within existing agent-sdk package boundaries, no new packages required. Clear separation between hook execution (services) and message handling (managers). **POST-DESIGN**: Confirmed - all enhancements are within agent-sdk package with clear boundaries.

✅ **TypeScript Excellence**: All code will use strict TypeScript with comprehensive type definitions for hook output structures, exit codes, and message blocks. **POST-DESIGN**: Confirmed - comprehensive type contracts defined for all hook output processing.

✅ **Test Alignment**: Tests will be in `packages/agent-sdk/tests/agent/` following feature-based organization. All tests will mock services (hook execution, file IO, network) to avoid real operations. No files will be created in examples directories. **POST-DESIGN**: Confirmed - test strategy aligns with constitution requirements and user input guidance.

✅ **Build Dependencies**: Changes are within agent-sdk package, requiring `pnpm build` before testing in dependent packages. **POST-DESIGN**: Confirmed - no cross-package dependencies introduced.

✅ **Documentation Minimalism**: No new documentation files created, focusing on clear code and inline documentation. **POST-DESIGN**: Confirmed - only specification artifacts created, no additional documentation.

✅ **Quality Gates**: Will run `pnpm run type-check` and `pnpm run lint` after all modifications. **POST-DESIGN**: Confirmed - TypeScript contracts ensure type safety.

✅ **Source Code Structure**: Following established patterns - managers for state logic, services for hook execution, utils for pure functions, types for cross-file definitions. **POST-DESIGN**: Confirmed - enhancement follows existing architectural patterns without introducing new structural complexity.

**Final Validation**: All constitutional requirements satisfied. Feature implementation preserves existing architecture while adding new functionality through established patterns.

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
### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   ├── aiManager.ts            # Enhanced: process PreToolUse/PostToolUse/Stop hook results
│   │   ├── hookManager.ts          # Enhanced: hook result processing logic
│   │   └── messageManager.ts       # Enhanced: add removeLastUserMessage() method
│   ├── agent.ts                    # Enhanced: process UserPromptSubmit hook results
│   ├── services/
│   │   └── hook.ts                 # Current: exit code/output fields already exist
│   ├── types/
│   │   └── hooks.ts                # Current: HookExecutionResult already has all needed fields
│   └── utils/
│       └── messageOperations.ts    # Enhanced: add removeLastUserMessage utility function
└── tests/
    └── agent/
        └── hooks-exitcode-output/  # New: comprehensive test suite with full mocking
            ├── hook-success.test.ts
            ├── hook-blocking-errors.test.ts
            └── hook-non-blocking-errors.test.ts
```

**Structure Decision**: Enhancing existing agent-sdk package structure following established patterns. Key enhancements include adding `removeLastUserMessage()` method to MessageManager and processing hook results in both aiManager.ts (for PreToolUse/PostToolUse/Stop hooks) and agent.ts (for UserPromptSubmit hooks). New functionality integrated into existing managers rather than creating new modules, maintaining backward compatibility.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

