# Implementation Plan: SDK Usage Tracking and Callback System

**Branch**: `007-usage-tracking-callback` | **Date**: 2025-11-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-usage-tracking-callback/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement SDK usage tracking system with `onUsagesChange` callback registration, `get usages()` method, and CLI exit token summary. Track token usage (prompt, completion, total) for both agent calls and message compression operations. Store usage data as metadata within assistant messages for session persistence. Add CLI functionality to display per-model token summaries on exit.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

## Technical Context

**Language/Version**: TypeScript 5.9+ (Node.js 16+)  
**Primary Dependencies**: OpenAI SDK 5.12.2, existing callback system in agent-sdk  
**Storage**: Session files (JSON) for usage metadata persistence  
**Testing**: Vitest 3.2.4 for unit/integration tests, existing test infrastructure  
**Target Platform**: Node.js CLI application, monorepo packages (agent-sdk + code)  
**Project Type**: Monorepo - feature spans agent-sdk (core) and code (CLI) packages  
**Performance Goals**: <100ms callback notification, <5% overhead for usage tracking  
**Constraints**: <500ms CLI exit summary display, graceful error handling required  
**Scale/Scope**: Per-session tracking, cumulative statistics, model-specific aggregation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Feature extends existing agent-sdk package (callback system, Message types) and code package (CLI exit handling). No new packages needed, clear boundaries maintained.

✅ **II. TypeScript Excellence**: All implementation will use strict TypeScript with OpenAI Usage type definitions. No `any` types required.

✅ **III. Test Alignment**: Tests will follow existing patterns - `packages/agent-sdk/tests/` for SDK features, `packages/code/tests/` for CLI features. Integration tests use temporary directories.

✅ **IV. Build Dependencies**: Changes to agent-sdk require `pnpm build` before testing in code package. Standard workflow maintained.

✅ **V. Documentation Minimalism**: Only implementation artifacts (research.md, data-model.md, etc.) created. No additional documentation planned.

✅ **VI. Quality Gates**: All changes will pass `pnpm run type-check` and `pnpm run lint` before committing.

**PASS** - No constitution violations detected.

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
│   ├── types.ts                    # Add Usage callback types, extend Message interface
│   ├── agent.ts                    # Add public get usages() method
│   ├── services/aiService.ts       # Already returns usage data from OpenAI
│   ├── managers/
│   │   ├── messageManager.ts       # Add usage metadata to messages, trigger callbacks
│   │   └── aiManager.ts            # Integrate usage tracking with AI operations
│   └── utils/messageOperations.ts  # Add usage field to message operations
└── tests/
    ├── services/aiService.test.ts  # Test usage data capture
    ├── agent/agent.usages.test.ts  # Test public usages API
    └── managers/messageManager.test.ts # Test callback triggering

packages/code/
├── src/
│   ├── cli.tsx                     # Add exit token summary to cleanup function
│   ├── print-cli.ts               # Add exit token summary to both paths
│   └── utils/
│       └── usageSummary.ts         # New utility for token aggregation by model
└── tests/
    └── utils/usageSummary.test.ts  # Test token summary calculations
```

**Structure Decision**: Extends existing monorepo structure. Core usage tracking in agent-sdk package, CLI integration in code package. No new packages required - follows constitution principle I.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

