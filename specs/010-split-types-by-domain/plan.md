# Implementation Plan: Split Types by Domain

**Branch**: `010-split-types-by-domain` | **Date**: 2025-11-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-split-types-by-domain/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Refactor the monolithic `packages/agent-sdk/src/types/index.ts` file into domain-specific type files (messaging, MCP, configuration, skills, tools, utilities) while removing unused types (AIRequest, AIResponse, ConfigurationResolver, ConfigurationValidator). Maintain backward compatibility through re-exports in the main index file.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with ES modules (existing)
**Primary Dependencies**: None (internal refactoring)
**Storage**: File system (TypeScript source files)
**Testing**: Vitest (existing framework)
**Target Platform**: Node.js 16+ (existing)
**Project Type**: Monorepo package (agent-sdk)
**Performance Goals**: No performance impact, potentially improved tree-shaking
**Constraints**: Must maintain backward compatibility, zero breaking changes
**Scale/Scope**: 358 lines of types split into ~6 domain files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Package-First Architecture ✅
**Status**: COMPLIANT - Refactoring within existing `agent-sdk` package boundaries, no inter-package changes required.

### II. TypeScript Excellence ✅
**Status**: COMPLIANT - Pure TypeScript refactoring, improves type organization without compromising type safety.

### III. Test Alignment ✅
**Status**: COMPLIANT - No test structure changes needed, existing tests will validate type refactoring works correctly.

### IV. Build Dependencies ✅
**Status**: COMPLIANT - Changes are within `agent-sdk`, will require `pnpm build` after modifications as per constitution.

### V. Documentation Minimalism ✅
**Status**: COMPLIANT - No new documentation files created, only internal code reorganization.

### VI. Quality Gates ✅
**Status**: COMPLIANT - TypeScript compilation and linting must pass after refactoring, critical for type reorganization.

### VII. Source Code Structure ✅
**Status**: COMPLIANT - Aligns with constitution's types.ts guidance by organizing types into logical domains within the types directory.

**Overall Gate Status**: ✅ PASS - All constitutional principles satisfied.

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
packages/agent-sdk/src/types/
├── index.ts                 # Main index with backward-compatible exports
├── messaging.ts             # Message, MessageBlock types and variants
├── mcp.ts                   # MCP server, tool, and configuration types
├── configuration.ts         # Gateway, model, validation configuration types
├── skills.ts                # Skill management and metadata types  
├── tools.ts                 # Background shell, slash command types
├── utilities.ts             # Logger, Usage, error types
└── constants.ts             # SKILL_DEFAULTS and CONFIG_ERRORS constants
```

**Structure Decision**: Using existing monorepo `agent-sdk` package with types organized into domain-specific files. Each domain file contains related types, while the main index maintains backward compatibility through re-exports. No additional testing infrastructure needed - existing tests will validate that the refactoring doesn't break functionality.

## Constitution Check - Post Design

*Re-evaluation after Phase 1 design completion*

### I. Package-First Architecture ✅
**Status**: COMPLIANT - Design maintains single package boundary with clean internal organization.

### II. TypeScript Excellence ✅
**Status**: COMPLIANT - Domain organization improves type safety and developer experience with strict typing maintained.

### III. Test Alignment ✅
**Status**: COMPLIANT - Test strategy defined in project structure aligns with constitution requirements for tests directory organization.

### IV. Build Dependencies ✅
**Status**: COMPLIANT - Design requires build after changes, following established workflow.

### V. Documentation Minimalism ✅
**Status**: COMPLIANT - No new external documentation created; internal type organization only.

### VI. Quality Gates ✅
**Status**: COMPLIANT - Design preserves all existing type definitions, ensuring TypeScript compilation and linting pass.

### VII. Source Code Structure ✅
**Status**: ENHANCED - Domain organization strongly aligns with constitution's guidance on functional organization over technical organization.

**Final Gate Status**: ✅ PASS - All constitutional principles satisfied with enhanced alignment on structure principle.

## Phase Completion Summary

### ✅ Phase 0: Research & Analysis (COMPLETED)
- **Output**: `research.md` with comprehensive type analysis and domain organization decisions
- **Key Findings**: 7 logical domains identified, 4 unused types confirmed for removal, core layer pattern prevents circular dependencies

### ✅ Phase 1: Design & Contracts (COMPLETED)  
- **Output**: `data-model.md`, `contracts/typescript-interfaces.md`, `quickstart.md`
- **Key Deliverables**: Domain entity model defined, TypeScript interface contracts specified, developer usage guide created
- **Agent Context**: Updated with TypeScript ES modules and file system technologies

### 📋 Phase 2: Task Breakdown (Next Command)
- **Command**: `/speckit.tasks` - Create detailed implementation tasks
- **Prerequisites**: All Phase 0-1 artifacts completed and validated
- **Expected Output**: `tasks.md` with specific implementation steps

## Ready for Implementation

This plan provides the foundation for splitting types by domain while maintaining backward compatibility. All constitutional requirements are satisfied, and the design enables improved developer experience through domain-specific imports.

