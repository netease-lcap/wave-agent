# Implementation Plan: SessionDir Constructor Argument

**Branch**: `008-sessiondir-constructor-arg` | **Date**: 2025-11-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-sessiondir-constructor-arg/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add optional `sessionDir` constructor argument to Agent SDK, allowing developers to specify custom session storage directories while maintaining backward compatibility with default `~/.wave/sessions` behavior. The implementation requires modifying the AgentOptions interface, Agent constructor, and all session service functions to support configurable session directory paths.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9.2, Node.js 16+  
**Primary Dependencies**: Node.js fs/path modules, existing session service architecture  
**Storage**: JSON files in configurable directory structure  
**Testing**: Vitest, integration tests with temporary directories  
**Target Platform**: Node.js environments (CLI, server-side applications)  
**Project Type**: Monorepo package modification (agent-sdk)  
**Performance Goals**: Session operations complete within same timeframes as current implementation  
**Constraints**: Backward compatibility required, no breaking changes to existing API  
**Scale/Scope**: Single interface modification affecting session storage across entire SDK

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial Check (✅ PASSED)
**I. Package-First Architecture**: ✅ **PASS** - Modification contained within existing `agent-sdk` package boundaries  
**II. TypeScript Excellence**: ✅ **PASS** - All code will use strict TypeScript with proper type definitions  
**III. Test Alignment**: ✅ **PASS** - Tests will be placed in `packages/agent-sdk/tests` with integration tests using temporary directories  
**IV. Build Dependencies**: ✅ **PASS** - Will run `pnpm build` after modifications to propagate changes  
**V. Documentation Minimalism**: ✅ **PASS** - No new documentation files required, only code changes  
**VI. Quality Gates**: ✅ **PASS** - Will run `pnpm run type-check` and `pnpm run lint` after implementation

### Post-Design Re-evaluation (✅ PASSED)
**I. Package-First Architecture**: ✅ **CONFIRMED** - All changes remain within `agent-sdk` package, no cross-package dependencies added
**II. TypeScript Excellence**: ✅ **CONFIRMED** - Contracts define strict TypeScript interfaces, no `any` types introduced
**III. Test Alignment**: ✅ **CONFIRMED** - Test strategy uses integration tests with temporary directories as required
**IV. Build Dependencies**: ✅ **CONFIRMED** - Changes to `agent-sdk` will require build before testing in dependent packages
**V. Documentation Minimalism**: ✅ **CONFIRMED** - Only internal code documentation, no additional .md files in source
**VI. Quality Gates**: ✅ **CONFIRMED** - Implementation will be validated with type-check and lint before completion

**Final Result**: All constitution principles satisfied throughout design phase. No violations to justify.

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
│   ├── agent.ts              # Modified: Add sessionDir to AgentOptions, pass to MessageManager
│   ├── types.ts              # Modified: Add sessionDir? to AgentOptions interface
│   ├── managers/
│   │   └── messageManager.ts # Modified: Accept and use sessionDir parameter
│   └── services/
│       └── session.ts        # Modified: Accept sessionDir parameter, replace hardcoded SESSION_DIR
└── tests/
    ├── agent/
    │   └── sessiondir.test.ts # New: Integration tests for sessionDir functionality
    └── services/
        └── session.test.ts     # Modified: Add tests for custom sessionDir behavior
```

**Structure Decision**: Modifying existing `agent-sdk` package structure. All changes contained within the established monorepo pattern with proper test organization following the constitution's test alignment principle.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

