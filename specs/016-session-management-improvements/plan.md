# Implementation Plan: Session Management Improvements

**Branch**: `016-session-management-improvements` | **Date**: 2025-11-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-session-management-improvements/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Improve Wave agent session management by:
1. Changing default session directory from `~/.wave/sessions` to `~/.wave/projects` with project-based subdirectories
2. Switching from JSON to JSONL format with UUIDv6 filenames for better performance
3. Implementing working directory path encoding for reliable cross-platform storage
4. Adding message-level persistence during AI recursion in `sendAIMessage()` finally block for improved reliability and guaranteed message saving regardless of success or failure

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9+ with Node.js 16+  
**Primary Dependencies**: Node.js fs/promises, uuid@latest (for UUIDv6), path utilities, crypto (for hash generation)  
**Storage**: Local filesystem - JSONL files in hierarchical directory structure  
**Testing**: Vitest with mocking for unit tests, real filesystem operations for integration tests  
**Target Platform**: Cross-platform Node.js CLI application
**Project Type**: Node.js monorepo package (agent-sdk modifications)  
**Performance Goals**: Fast session loading using UUIDv6 time ordering, append-only JSONL writes  
**Constraints**: Filesystem path length limits, cross-platform directory name encoding  
**Scale/Scope**: Multi-project session management, thousands of sessions per project

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial Evaluation (Pre-Research)
**I. Package-First Architecture**: ✅ PASS - Modifications confined to agent-sdk package, no new packages needed  
**II. TypeScript Excellence**: ✅ PASS - Strict typing maintained, existing type definitions enhanced  
**III. Test Alignment**: ✅ PASS - Tests will follow TDD workflow, existing test structure maintained  
**IV. Build Dependencies**: ✅ PASS - Changes to agent-sdk will require build before testing in code package  
**V. Documentation Minimalism**: ✅ PASS - No new documentation files created unless requested  
**VI. Quality Gates**: ✅ PASS - All type-check and lint requirements will be met  
**VII. Source Code Structure**: ✅ PASS - Session service modifications follow established patterns  
**VIII. Test-Driven Development**: ✅ PASS - Tests written before implementation per TDD workflow

### Post-Design Re-evaluation
**I. Package-First Architecture**: ✅ CONFIRMED - Design maintains clear boundaries, agent-sdk encapsulation preserved  
**II. TypeScript Excellence**: ✅ CONFIRMED - Comprehensive interface definitions created, strict typing enforced  
**III. Test Alignment**: ✅ CONFIRMED - TDD approach outlined in quickstart, test organization maintained  
**IV. Build Dependencies**: ✅ CONFIRMED - Only agent-sdk modified, build process unchanged  
**V. Documentation Minimalism**: ✅ CONFIRMED - Design docs are spec artifacts, not permanent documentation  
**VI. Quality Gates**: ✅ CONFIRMED - Type checking enforced through interface contracts  
**VII. Source Code Structure**: ✅ CONFIRMED - Service/manager pattern preserved, utils for pure functions  
**VIII. Test-Driven Development**: ✅ CONFIRMED - Quickstart emphasizes test-first development approach

**Final Status**: ✅ **ALL PRINCIPLES SATISFIED** - Feature fully compliant with Wave Agent Constitution v1.4.0

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
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── services/
│   │   │   └── session.ts          # MODIFIED: Core session management logic
│   │   ├── managers/
│   │   │   ├── messageManager.ts   # MODIFIED: Session integration points
│   │   │   └── aiManager.ts        # MODIFIED: Message persistence in recursion
│   │   ├── utils/
│   │   │   └── pathEncoder.ts      # NEW: Directory path encoding utilities
│   │   └── types/
│   │       └── index.ts           # MODIFIED: Updated session interfaces
│   └── tests/
│       └── services/
│           ├── session.test.ts     # MODIFIED: Enhanced session tests
│           └── pathEncoder.test.ts # NEW: Path encoding tests
└── code/
    └── src/
        └── utils/
            └── constants.ts        # MODIFIED: Update session directory constants
```

**Structure Decision**: Existing monorepo structure maintained. Changes focused on agent-sdk package with minimal impact on code package. Session management logic centralized in services layer following established patterns.

## Phase 0: Research & Clarifications

*Extract unknowns from Technical Context and resolve through research*

