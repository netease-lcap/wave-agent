# Implementation Plan: Subagent Message Callbacks

**Branch**: `015-subagent-message-callbacks` | **Date**: 2025-11-20 | **Status**: ✅ Completed | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-subagent-message-callbacks/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add granular message callbacks for subagents through dedicated SubagentManagerCallbacks interface. Implemented via architectural refactoring that moved subagent callback responsibility from MessageManager to SubagentManager for cleaner separation of concerns. Extended to remove messages from SubagentBlock type and manage them via callbacks in UI layer.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (strict mode enabled)  
**Primary Dependencies**: Existing agent-sdk managers (MessageManager, SubagentManager), OpenAI SDK, crypto module  
**Storage**: N/A - callback system handles events in-memory  
**Testing**: Vitest with mocking for external dependencies  
**Target Platform**: Node.js runtime (packages work in both CLI and programmatic contexts)
**Project Type**: TypeScript library extension - extends existing monorepo packages  
**Performance Goals**: Simple callback dispatch, no batching or optimization needed  
**Constraints**: Must maintain backward compatibility, callbacks must be optional, no breaking changes to existing API  
**Scale/Scope**: Support multiple concurrent subagents (10-100 typical), basic callback forwarding without advanced features

## Constitution Check (Post-Design)

*GATE: Re-evaluation after Phase 1 design completion.*

✅ **Package-First Architecture**: Extends existing `agent-sdk` package only, maintains clear boundaries  
✅ **TypeScript Excellence**: All interfaces use strict typing, comprehensive type definitions created  
✅ **Test Alignment**: Test structure planned for `packages/agent-sdk/tests/managers/`, TDD approach defined  
✅ **Build Dependencies**: Only `agent-sdk` changes, build process clearly defined  
✅ **Documentation Minimalism**: Only spec artifacts created, no unnecessary documentation  
✅ **Quality Gates**: Type definitions ensure type-check will pass, callback interfaces maintain consistency  
✅ **Source Code Structure**: Changes follow established manager pattern, callback system fits existing architecture  
✅ **Test-Driven Development**: Implementation plan specifies TDD workflow with failing tests first

**Result**: ✅ PASS - All constitutional principles maintained through design phase

**Design Validation**: Interface extensions maintain 100% backward compatibility, performance contracts defined, error handling patterns established. Ready for Phase 2 (implementation).

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
# Implemented Wave Agent monorepo structure
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   ├── messageManager.ts     # Unchanged - no subagent callbacks added here
│   │   │   └── subagentManager.ts    # ✅ MODIFIED: Uses SubagentManagerCallbacks interface  
│   │   └── agent.ts                  # ✅ MODIFIED: AgentCallbacks extends SubagentManagerCallbacks
│   └── tests/
│       └── managers/
│           └── subagentManager/      # ✅ UPDATED: Tests reflect new callback ownership
└── code/
    └── src/
        └── components/              # FUTURE: UI components may use new callbacks
```

**Architecture Decision**: Created dedicated SubagentManagerCallbacks interface instead of extending MessageManagerCallbacks, providing cleaner separation between main agent and subagent callback responsibilities.



