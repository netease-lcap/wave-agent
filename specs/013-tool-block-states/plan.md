# Implementation Plan: Tool Block Stage Updates

**Branch**: `013-tool-block-states` | **Date**: 2025-11-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/013-tool-block-states/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add `stage` field to `onToolBlockUpdated` callback with values `start`, `streaming`, `running`, `end`. Remove deprecated `isRunning` field. Enable SDK integrators to display tool execution lifecycle with proper timing for announcements, streaming output, running status, and final results.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.x (existing monorepo)  
**Primary Dependencies**: Existing Wave Agent SDK infrastructure  
**Storage**: N/A (in-memory event callbacks)  
**Testing**: Vitest with TDD workflow, existing test patterns  
**Target Platform**: Node.js CLI environment (existing)
**Project Type**: Monorepo package enhancement (agent-sdk)  
**Performance Goals**: No performance regression, minimal overhead for stage transitions  
**Constraints**: Backward compatibility for existing callback consumers (except deprecated field removal)  
**Scale/Scope**: Single interface modification affecting all tool execution callbacks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Feature modifies existing agent-sdk package interface
✅ **II. TypeScript Excellence**: Type definitions required for new stage field and updated callback
✅ **III. Test Alignment**: TDD required for new stage lifecycle behavior
✅ **IV. Build Dependencies**: agent-sdk changes require build before testing
✅ **V. Documentation Minimalism**: No additional documentation needed beyond code changes
✅ **VI. Quality Gates**: Type checking and linting must pass
✅ **VII. Source Code Structure**: Changes follow existing agent-sdk patterns
✅ **VIII. Test-Driven Development**: TDD workflow required for stage transitions

**All constitution gates pass** - no violations or complexity justification needed.

## Project Structure

### Documentation (this feature)

```
specs/013-tool-block-states/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - COMPLETE
├── data-model.md        # Phase 1 output - COMPLETE
├── quickstart.md        # Phase 1 output - COMPLETE
├── contracts/           # Phase 1 output - COMPLETE
│   └── typescript-interface.md
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
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── types.ts              # Updated callback interface types
│   │   ├── managers/            # Tool execution logic
│   │   └── services/            # Event emission logic
│   └── tests/
│       └── agent/              # Tests for tool execution lifecycle
└── code/
    ├── src/
    │   ├── components/          # UI components using updated callbacks
    │   └── hooks/              # Custom hooks for stage handling
    └── tests/
        └── components/         # Tests for UI component updates
```

**Structure Decision**: Existing Wave Agent monorepo structure. Changes primarily in `agent-sdk` package for core logic and type definitions, with corresponding updates in `code` package for UI integration.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

