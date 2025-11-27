# Implementation Plan: Nested Markdown Discovery for Slash Commands

**Branch**: `018-nested-md-discovery` | **Date**: 2025-11-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-nested-md-discovery/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enhance slash command discovery to support nested directory structures within `.wave/commands/`. Commands at root level (e.g., `.wave/commands/help.md`) use simple syntax (`/help`), while nested commands (e.g., `.wave/commands/openspec/apply.md`) use colon syntax (`/openspec:apply`). Maximum nesting depth limited to 1 level (root + 1 level deep).

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with Node.js 16+  
**Primary Dependencies**: Node.js fs/path modules, existing wave-agent-sdk  
**Storage**: File system (.wave/commands directory structure)  
**Testing**: Vitest (existing framework)  
**Target Platform**: Node.js CLI environment
**Project Type**: Monorepo package enhancement (agent-sdk)  
**Performance Goals**: <50ms command discovery, minimal startup impact  
**Constraints**: Backward compatibility with existing flat commands, no UI changes to CommandSelector  
**Scale/Scope**: Support for hundreds of nested commands, 1-level nesting limit

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**✅ I. Package-First Architecture**: Enhancement targets agent-sdk package, maintains clear boundaries with code package  
**✅ II. TypeScript Excellence**: All code will use strict TypeScript with proper type definitions  
**✅ III. Test Alignment**: Tests will be in packages/agent-sdk/tests following TDD principles  
**✅ IV. Build Dependencies**: Will run pnpm build on agent-sdk after changes  
**✅ V. Documentation Minimalism**: No new markdown docs created (per constitution)  
**✅ VI. Quality Gates**: Must pass type-check and lint before completion  
**✅ VII. Source Code Structure**: Will follow existing utils/managers pattern in agent-sdk  
**✅ VIII. Test-Driven Development**: Will write failing tests first, then implement  

**✅ POST-DESIGN RE-CHECK**: All gates continue to pass after Phase 1 design:
- **Package boundaries**: Changes isolated to agent-sdk utils/managers
- **TypeScript**: Enhanced interfaces maintain strict typing  
- **TDD workflow**: Quickstart specifies Red-Green-Refactor cycle
- **No new docs**: Only internal contracts and data models (planning artifacts)
- **Structure compliance**: Following established customCommands.ts patterns

**No violations detected** - all gates pass

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
│   ├── utils/
│   │   └── customCommands.ts          # Enhanced for nested discovery
│   ├── managers/
│   │   └── slashCommandManager.ts     # Updated to use nested commands
│   └── types/
│       └── commands.ts                # Updated with nested command types
└── tests/
    ├── utils/
    │   └── customCommands.test.ts      # Test nested discovery logic
    └── managers/
        └── slashCommandManager.test.ts # Test integration with manager

packages/code/
└── src/
    └── components/
        └── CommandSelector.tsx         # No changes needed (per requirement)
```

**Structure Decision**: Monorepo package enhancement targeting agent-sdk. Primary changes in `utils/customCommands.ts` for discovery logic and `managers/slashCommandManager.ts` for integration. No changes required to code package UI components per requirement to maintain current CommandSelector implementation.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

