# Implementation Plan: Workflow — Deterministic Multi-Subagent Orchestration

**Branch**: `080-workflow` | **Date**: 2026-06-07 | **Spec**: [./spec.md](./spec.md)

## Summary

Implement the Workflow tool and runtime for deterministic multi-subagent orchestration. The AI model calls the Workflow tool with a JavaScript script that uses `agent()`, `pipeline()`, `parallel()`, and `phase()` APIs to coordinate dozens of subagents in parallel. Workflows run in the background, persist scripts and journals, and deliver results via the notification system.

## Technical Context

**Language/Version**: TypeScript (Strict)
**Primary Dependencies**: `agent-sdk` (SubagentManager, BackgroundTaskManager, NotificationQueue, ToolManager), `code` (TaskNotificationMessage)
**Storage**: JSONL journal per run, JS script per run, in-memory WorkflowRun state
**Testing**: Vitest
**Target Platform**: Node.js (CLI)
**Project Type**: pnpm monorepo
**Performance Goals**: Concurrency cap at min(16, cpu-2), agent limit 1000 per run
**Constraints**: No filesystem/Node.js access in scripts, no Date.now/Math.random (resume determinism), opt-in required
**Scale/Scope**: 1 tool, 1 manager, 8 workflow modules, 2 slash commands, 9 test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic in `packages/agent-sdk`, UI in `packages/code`.
- [x] **TypeScript Excellence**: All new code uses strict TypeScript.
- [x] **Test Alignment**: Unit tests in `packages/agent-sdk/tests/workflow/` (9 test files, 112 tests).
- [x] **Build Dependencies**: `pnpm build` after agent-sdk changes.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm test`, `pnpm lint` for validation.
- [x] **Data Model Minimalism**: WorkflowRun, JournalEntry, WorkflowMeta interfaces.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test` to validate.

## Project Structure

### Documentation (this feature)

```
specs/080-workflow/
├── plan.md              # This file
└── spec.md              # Feature specification
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── workflow/
│   │   ├── types.ts                # WorkflowRun, WorkflowMeta, JournalEntry, BudgetInfo
│   │   ├── concurrencyLimiter.ts   # Semaphore: acquire()/release(), FIFO queue
│   │   ├── budgetTracker.ts        # Token budget tracking
│   │   ├── progressReporter.ts     # Phase-aware progress reporting
│   │   ├── journal.ts              # JSONL journal for deterministic resume
│   │   ├── structuredOutput.ts     # StructuredOutput tool injection + extraction
│   │   ├── workflowApis.ts         # agent(), parallel(), pipeline(), phase(), log()
│   │   └── scriptRuntime.ts        # Validation, meta parsing, new Function() execution
│   ├── managers/
│   │   ├── workflowManager.ts      # Lifecycle: create, start, stop, resume, list
│   │   ├── toolManager.ts          # + workflowTool in builtInTools, workflowManager in context
│   │   └── slashCommandManager.ts  # + /workflows, /deep-research commands
│   ├── tools/
│   │   ├── workflowTool.ts         # ToolPlugin with full prompt + execute
│   │   └── types.ts                # + workflowManager in ToolContext
│   ├── types/
│   │   ├── processes.ts            # + BackgroundWorkflow type
│   │   └── messaging.ts            # + "workflow" in TaskNotificationBlock.taskType
│   ├── constants/
│   │   └── tools.ts                # + WORKFLOW_TOOL_NAME
│   └── utils/
│       ├── containerSetup.ts       # + register WorkflowManager
│       └── notificationXml.ts      # + parse "workflow" task type
└── tests/
    └── workflow/
        ├── concurrencyLimiter.test.ts
        ├── budgetTracker.test.ts
        ├── progressReporter.test.ts
        ├── journal.test.ts
        ├── scriptRuntime.test.ts
        ├── structuredOutput.test.ts
        ├── workflowApis.test.ts
        ├── workflowManager.test.ts
        └── workflowTool.test.ts

packages/code/
├── src/
│   └── components/
│       └── TaskNotificationMessage.tsx  # + "aborted" status color

packages/agent-sdk/
└── examples/
    └── workflow-demo.ts            # End-to-end example
```

**Structure Decision**: Monorepo structure with runtime in `workflow/` module, lifecycle in `managers/`, tool in `tools/`, tests in `tests/workflow/`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
