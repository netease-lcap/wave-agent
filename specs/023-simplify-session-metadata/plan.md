# Implementation Plan: Simplify Session Metadata Storage

**Branch**: `023-simplify-session-metadata` | **Date**: 2025-12-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-simplify-session-metadata/spec.md`

**Note**: This implementation plan has been completed through Phase 1. All technical clarifications resolved through research phase. Design artifacts generated and constitutional compliance verified. Ready for Phase 2 task breakdown via `/speckit.tasks`.

## Summary

Optimize session storage performance by eliminating metadata headers from JSONL session files and implementing filename-based session identification. Remove unused fields (startedAt, parentSessionId) and use "subagent-" filename prefix for subagent sessions. This reduces session listing operations from O(n*m) where m=file_size to O(n) where n=number_of_files, while maintaining compatibility with existing session operations.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with Node.js (existing codebase)  
**Primary Dependencies**: Vitest for testing, existing agent-sdk filesystem operations  
**Storage**: JSONL files on local filesystem (existing pattern)  
**Testing**: Vitest with mocked filesystem operations  
**Target Platform**: Cross-platform Node.js (Linux, macOS, Windows)
**Project Type**: Monorepo packages (agent-sdk core changes, code package compatibility)  
**Performance Goals**: 8-10x improvement in session listing operations (2-5s → 200-500ms for 1000+ sessions)  
**Constraints**: Maintain backward compatibility for existing session file reading, preserve session restoration functionality  
**Scale/Scope**: Support up to 5,000+ sessions per project based on real-world usage analysis

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Changes confined to existing agent-sdk package structure with clear boundaries maintained  
✅ **II. TypeScript Excellence**: All new code uses strict TypeScript with comprehensive type definitions in contracts  
✅ **III. Test Alignment**: TDD approach with tests in packages/agent-sdk/tests, comprehensive test coverage planned  
✅ **IV. Build Dependencies**: Will run pnpm build after agent-sdk modifications before testing in dependent packages  
✅ **V. Documentation Minimalism**: No new documentation files beyond specification artifacts  
✅ **VI. Quality Gates**: Type-check and lint validation will be run after all modifications  
✅ **VII. Source Code Structure**: Following established agent-sdk patterns (services/, types/, managers/)  
✅ **VIII. Test-Driven Development**: TDD workflow implemented with Red-Green-Refactor cycle in quickstart  
✅ **IX. Type System Evolution**: Modified existing SessionMetadataLine interface, added ParsedSessionFilename as extension

**Post-Design Re-evaluation**:
- All constitutional requirements satisfied in design phase
- Type evolution properly implemented (modified vs created new types)
- Test strategy aligns with TDD principles  
- Performance optimizations maintain architectural integrity
- Backward compatibility preserves existing API contracts

**Gate Status**: ✅ PASS - All constitutional requirements satisfied through design completion

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
│   ├── services/
│   │   ├── jsonlHandler.ts     # Remove createSession metadata writing
│   │   └── session.ts          # Update listSessionsFromJsonl, remove readMetadata calls
│   ├── types/
│   │   └── session.ts          # Remove/update SessionMetadataLine interface
│   └── managers/
│       └── messageManager.ts   # Update session creation with new patterns
└── tests/
    ├── services/
    │   ├── jsonlHandler.test.ts  # Test new session creation without metadata
    │   └── session.test.ts       # Test filename-based session listing
    └── integration/
        └── session-metadata.integration.test.ts  # End-to-end testing

packages/code/
└── src/
    └── [existing CLI unchanged - compatibility maintained]
```

**Structure Decision**: Leveraging existing monorepo packages structure. Changes confined to agent-sdk package with no CLI modifications needed, maintaining the established separation between core functionality (agent-sdk) and user interface (code).

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

