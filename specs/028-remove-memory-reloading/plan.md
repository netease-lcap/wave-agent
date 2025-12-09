# Implementation Plan: Remove Memory File Live Reloading and Simplify Memory Architecture

**Branch**: `028-remove-memory-reloading` | **Date**: 2025-12-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/028-remove-memory-reloading/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Remove memory file live reloading functionality and simplify memory architecture by:
1. Loading memory files only once during agent initialization instead of continuous monitoring
2. Storing memory content directly in Agent class properties instead of separate MemoryStoreService
3. Removing MemoryStoreService infrastructure and related files
4. Merging ConfigurationWatcher and LiveConfigManager into single component
5. Updating memory utility functions to work with Agent-based storage

## Technical Context

**Language/Version**: TypeScript (existing codebase)
**Primary Dependencies**: Node.js, chokidar (file watching), existing agent-sdk architecture
**Storage**: File system (AGENTS.md, user memory files) - no database
**Testing**: Vitest, existing test infrastructure
**Target Platform**: Node.js server environment (CLI tool)
**Project Type**: Monorepo package (agent-sdk) - refactoring existing functionality
**Performance Goals**: Reduced overhead by eliminating continuous file watching
**Constraints**: Must maintain backward compatibility for public APIs, must not break existing functionality
**Scale/Scope**: Core agent-sdk package refactoring affecting memory management and configuration

## Constitution Check (Post-Design)

*Final validation after Phase 1 design completion*

**✅ I. Package-First Architecture**: All changes remain within `agent-sdk` package. No new packages created. Clear boundaries maintained with existing package structure.

**✅ II. TypeScript Excellence**: All design maintains strict typing. Removed complex type definitions in favor of simple string properties. No `any` types introduced.

**✅ III. Test Alignment**: Test strategy focuses on essential functionality - memory loading at startup, content access through getters, and error handling. Existing test patterns preserved where possible.

**✅ IV. Build Dependencies**: Changes to `agent-sdk` require `pnpm build` before testing in dependent packages. No new build dependencies introduced.

**✅ V. Documentation Minimalism**: Only updated existing code documentation. No new markdown files beyond planning artifacts.

**✅ VI. Quality Gates**: Design ensures `pnpm run type-check` and `pnpm run lint` will pass. Type system simplified, not complicated.

**✅ VII. Source Code Structure**: Following established patterns - memory stored in Agent class (manager-level), utility functions remain in services, types consolidated.

**✅ VIII. Test-Driven Development**: Focusing on essential behavior testing - agent initialization, memory access, error handling. Not over-testing internal implementation details.

**✅ IX. Type System Evolution**: Modified existing Agent class rather than creating new types. Removed unnecessary type definitions (MemoryStoreService, etc.). Simplified type hierarchy.

**✅ X. Data Model Minimalism**: Eliminated complex MemoryStoreService abstraction. Simple string properties in Agent class. Flat, direct data access pattern.

**Design Quality Assessment**: The design significantly reduces complexity while maintaining all essential functionality. Architecture is simplified from multi-service to single-responsibility pattern.

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
│   ├── agent.ts              # Modified: Add memory storage properties
│   ├── managers/
│   │   └── liveConfigManager.ts   # Modified: Remove memory watching, merge with ConfigurationWatcher
│   ├── services/
│   │   ├── memory.ts              # Modified: Update to work with Agent-based storage
│   │   ├── memoryStore.ts         # DELETED
│   │   └── configurationWatcher.ts # MERGED into liveConfigManager.ts
│   └── types/
│       └── memoryStore.ts         # DELETED
└── tests/
    ├── services/
    │   ├── memory.test.ts         # Modified: Update tests for new architecture
    │   └── memoryStore.test.ts    # DELETED or updated
    └── agent/
        └── agent.test.ts          # Modified: Add memory loading tests
```

**Structure Decision**: This is a refactoring of existing agent-sdk package functionality. We are modifying existing files within the established package structure, removing unnecessary abstractions (MemoryStoreService), and consolidating configuration management components. The changes maintain the existing packages/agent-sdk organization while simplifying the internal architecture.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

