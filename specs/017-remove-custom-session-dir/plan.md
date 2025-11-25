# Implementation Plan: Remove Custom Session Dir Feature

**Branch**: `017-remove-custom-session-dir` | **Date**: 2025-11-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-remove-custom-session-dir/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Remove the custom sessionDir configuration parameter from the Agent SDK, simplifying the API by forcing all session storage to use the hardcoded default directory (~/.wave/projects). This is a breaking change that eliminates sessionDir parameters from AgentOptions, MessageManager, and all session service functions throughout the codebase.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with strict type checking enabled  
**Primary Dependencies**: Node.js, Vitest for testing, existing agent-sdk package structure  
**Storage**: File system session storage (JSONL files in ~/.wave/projects)  
**Testing**: Vitest framework following TDD principles  
**Target Platform**: Node.js environments (CLI and SDK usage)
**Project Type**: Monorepo package modification - removing functionality from existing agent-sdk package  
**Performance Goals**: No performance impact - removal of code should maintain or improve performance  
**Constraints**: Breaking change acceptable, must maintain default session behavior  
**Scale/Scope**: Affects AgentOptions interface, MessageManager class, session service functions, and related test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Modifications are contained within existing agent-sdk package boundaries. No new packages created or dependencies modified.

✅ **II. TypeScript Excellence**: Removal of sessionDir parameters improves type safety by eliminating optional configuration complexity. All interfaces now have clearer, simpler signatures.

✅ **III. Test Alignment**: Test files updated following TDD principles. Test files in `packages/agent-sdk/tests/` modified to remove sessionDir-related mocking and scenarios while maintaining comprehensive coverage of default behavior.

✅ **IV. Build Dependencies**: Must run `pnpm build` after modifying agent-sdk before testing in dependent packages (code package). Build process unchanged.

✅ **V. Documentation Minimalism**: No new documentation files created - only removal of existing functionality. Contracts and data model serve implementation purposes only.

✅ **VI. Quality Gates**: `pnpm run type-check` and `pnpm run lint` will be run after all modifications to ensure code quality. TypeScript errors expected for users trying to use removed sessionDir parameter (intentional breaking change).

✅ **VII. Source Code Structure**: Changes follow established patterns in agent-sdk: managers (MessageManager), services (session.ts), types (agent.ts interfaces). No new organizational patterns introduced.

✅ **VIII. Test-Driven Development**: Followed TDD workflow during design - contracts define failing tests (sessionDir rejection), implementation will make tests pass, refactoring planned for code clarity.

**Post-Design Re-evaluation**: ✅ PASSED - All constitution principles maintained through design phase. Breaking change is intentional and well-documented through contracts. Implementation plan preserves existing patterns while simplifying the API surface.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/
├── agent-sdk/              # Core SDK package (PRIMARY MODIFICATION TARGET)
│   ├── src/
│   │   ├── agent.ts         # AgentOptions interface - remove sessionDir
│   │   ├── managers/
│   │   │   ├── messageManager.ts    # Remove sessionDir parameter handling
│   │   │   └── subagentManager.ts   # Remove sessionDir usage
│   │   ├── services/
│   │   │   └── session.ts   # Remove sessionDir parameters from all functions
│   │   └── types/
│   │       └── session.ts   # Update session-related types if needed
│   └── tests/              # Update all sessionDir-related tests
│       ├── agent/
│       ├── managers/
│       ├── services/
│       └── utils/
│
├── code/                   # CLI package (INDIRECT IMPACT)
│   └── src/
│       └── index.ts        # May need updates if using sessionDir
│
└── .specify/              # Specification tooling (NO CHANGES)
    └── specs/017-remove-custom-session-dir/
```

**Structure Decision**: Existing monorepo structure maintained. Changes focused on agent-sdk package with potential minor updates to code package. No new files created - only removal and simplification of existing functionality.

## Complexity Tracking

No constitution violations identified. This feature removal simplifies the codebase by eliminating optional configuration complexity.
