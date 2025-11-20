# Implementation Plan: Subagent Message Callbacks

**Branch**: `015-subagent-message-callbacks` | **Date**: 2025-11-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-subagent-message-callbacks/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add simple granular message callbacks for subagents to enable basic tracking of individual message events (user messages, assistant messages, content streaming, tool usage) at the subagent level. This extends the existing callback system in MessageManager with straightforward callback forwarding, focusing on core functionality without complex error handling or performance monitoring.

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
# Existing Wave Agent monorepo structure - this feature extends existing files
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   ├── messageManager.ts     # MODIFY: Add new subagent callback interfaces to existing MessageManagerCallbacks
│   │   │   └── subagentManager.ts    # MODIFY: Update existing callback forwarding in createInstance()
│   │   └── utils/
│   │       └── messageOperations.ts # REVIEW: Ensure callback propagation
│   └── tests/
│       └── managers/
│           ├── messageManager/       # CREATE: New test organization
│           │   └── subagentCallbacks.test.ts  # CREATE: TDD test file
│           └── subagentManager/      # CREATE: New test organization  
│               └── callbackIntegration.test.ts # CREATE: Integration tests
└── code/
    └── src/
        └── components/              # FUTURE: UI components may use new callbacks
```

**Structure Decision**: This is a library extension within the existing monorepo. All changes are contained within the `agent-sdk` package, following the established manager pattern. No new packages required - we extend existing MessageManager and SubagentManager classes with new callback interfaces while maintaining backward compatibility.



