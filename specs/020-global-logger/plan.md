# Implementation Plan: Global Logger for Agent SDK

**Branch**: `020-global-logger` | **Date**: 2025-12-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-global-logger/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement a global logger system in the Agent SDK that allows utility functions and services to emit log messages without requiring logger parameters. The system will maintain a singleton logger instance accessible across all SDK modules while preserving backward compatibility with existing Agent initialization patterns.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (Node.js 16+)  
**Primary Dependencies**: None (uses existing Logger interface from agent-sdk)  
**Storage**: N/A  
**Testing**: Vitest (existing test framework)  
**Target Platform**: Node.js environments (server/CLI)
**Project Type**: SDK Library enhancement  
**Performance Goals**: Zero-overhead when no logger configured, minimal impact on function calls  
**Constraints**: Must not break existing function signatures, thread-safe access pattern  
**Scale/Scope**: Affects all utility functions and services in agent-sdk (~20 files)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Post-Design Re-evaluation (Phase 1 Complete):**

✅ **Package-First Architecture**: Design maintains single package (agent-sdk) enhancement with clear API boundaries  
✅ **TypeScript Excellence**: Uses existing Logger interface, no `any` types in design, strict type safety maintained  
✅ **Test Alignment**: TDD approach confirmed in contracts, tests in correct locations (`packages/agent-sdk/tests/`)  
✅ **Build Dependencies**: No additional external dependencies introduced, uses existing patterns  
✅ **Documentation Minimalism**: Generated contracts and quickstart serve implementation purpose, not user docs  
✅ **Quality Gates**: Design validates against type-check and lint requirements  
✅ **Source Code Structure**: Module-level pattern follows established utils/ organization principles  
✅ **TDD Workflow**: Test contracts defined, implementation will follow Red-Green-Refactor  
✅ **Type System Evolution**: Zero new types created, leverages existing Logger interface exclusively

**Design Validation**: All constitutional principles satisfied. No violations requiring justification.

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

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── utils/
│   │   └── globalLogger.ts        # NEW: Global logger registry
│   ├── services/
│   │   ├── memory.ts              # MODIFIED: Use global logger
│   │   └── [other services...]    # MODIFIED: Add logging calls
│   ├── agent.ts                   # MODIFIED: Initialize global logger
│   └── types/
│       └── core.ts                # EXISTING: Logger interface
└── tests/
    ├── utils/
    │   └── globalLogger.test.ts   # NEW: Global logger tests
    └── integration/
        └── globalLogger.integration.test.ts  # NEW: Integration tests
```

**Structure Decision**: Single package enhancement following existing agent-sdk organization. New global logger utility in utils/ directory, modifications to existing services and agent class, comprehensive test coverage in tests/ directory.



