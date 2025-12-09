# Implementation Plan: Refactor Configuration Management

**Branch**: `027-refactor-config-management` | **Date**: 2025-12-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/027-refactor-config-management/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Refactor the Wave Agent SDK's configuration management to eliminate redundant environment variable passing to hooks and centralize settings.json loading logic. Currently, environment variables from waveConfig.env are set to process.env but also passed separately to hook execution, creating duplication. Additionally, settings.json loading, validation, and merging logic is scattered across hook-specific files but should be available globally. The refactor will simplify configuration loading by removing complex fallback mechanisms and providing clear user feedback about configuration status.

## Technical Context

**Language/Version**: TypeScript (matches existing agent-sdk codebase)  
**Primary Dependencies**: Node.js fs module, existing agent-sdk architecture  
**Storage**: JSON files (settings.json, settings.local.json), process environment variables  
**Testing**: Vitest (existing framework), mocking for file system operations  
**Target Platform**: Node.js runtime (server/desktop environments)
**Project Type**: SDK refactoring within existing monorepo package structure  
**Performance Goals**: Configuration loading <50ms, minimal impact on existing performance  
**Constraints**: Must maintain backward compatibility, no breaking changes to public APIs  
**Scale/Scope**: Affects configuration management across entire agent-sdk package, ~5 core files to refactor

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial Check (Pre-Research): ✅ PASSED

✅ **I. Package-First Architecture**: Refactoring stays within agent-sdk package, maintains clear boundaries  
✅ **II. TypeScript Excellence**: All refactored code will maintain strict TypeScript typing  
✅ **III. Test Alignment**: Tests will be updated in packages/agent-sdk/tests following existing patterns  
✅ **IV. Build Dependencies**: Will run pnpm build after agent-sdk modifications  
✅ **V. Documentation Minimalism**: No new documentation files planned, focuses on code clarity  
✅ **VI. Quality Gates**: Will run type-check and lint after all changes  
✅ **VII. Source Code Structure**: Maintains existing services/managers/utils pattern in agent-sdk  
✅ **VIII. Test-Driven Development**: Will update existing tests and add focused tests for critical refactoring  
✅ **IX. Type System Evolution**: Will extend existing configuration types rather than creating new ones  
✅ **X. Data Model Minimalism**: Configuration entities are already minimal, no new complex models introduced

### Post-Design Check: ✅ PASSED

✅ **I. Package-First Architecture**: Design maintains agent-sdk package structure, creates new services following established patterns  
✅ **II. TypeScript Excellence**: All new interfaces use strict typing, extend existing types appropriately  
✅ **III. Test Alignment**: New service tests follow existing patterns, updated tests maintain structure  
✅ **IV. Build Dependencies**: Plan includes pnpm build step after agent-sdk changes  
✅ **V. Documentation Minimalism**: Only created required planning documents, no additional documentation  
✅ **VI. Quality Gates**: Quickstart includes type-check and lint validation steps  
✅ **VII. Source Code Structure**: New services follow services/ directory pattern, managers updated appropriately  
✅ **VIII. Test-Driven Development**: Test plan focuses on essential functionality and critical refactoring points  
✅ **IX. Type System Evolution**: New types extend existing WaveConfiguration and related interfaces  
✅ **X. Data Model Minimalism**: Data model maintains minimal entities, focuses on essential attributes only

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

### Documentation (this feature)

```
specs/027-refactor-config-management/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── services/
│   │   ├── configurationService.ts      # NEW: Centralized config loading/validation
│   │   ├── environmentService.ts        # NEW: Environment variable management  
│   │   └── hook.ts                      # REFACTORED: Remove config logic, keep execution only
│   ├── managers/
│   │   ├── liveConfigManager.ts         # UPDATED: Use new centralized services
│   │   └── hookManager.ts               # UPDATED: Remove embedded config logic
│   └── utils/
│       └── configPaths.ts               # EXISTING: Path utilities (no changes)
└── tests/
    ├── services/
    │   ├── configurationService.test.ts  # NEW: Tests for centralized config service
    │   ├── environmentService.test.ts    # NEW: Tests for environment management
    │   └── hook.test.ts                  # UPDATED: Remove config-related tests
    └── managers/
        ├── liveConfigManager.test.ts     # UPDATED: Update for new service integration
        └── hookManager.test.ts           # UPDATED: Remove config logic tests
```

**Structure Decision**: Maintains existing agent-sdk package structure following services/managers pattern. Creates new centralized configuration services while refactoring existing hook services to focus on execution only.

## Complexity Tracking

*No constitutional violations identified - this section can be removed.*

