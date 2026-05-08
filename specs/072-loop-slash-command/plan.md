# Implementation Plan: /loop Slash Command

**Branch**: `072-loop-slash-command` | **Date**: 2026-03-24 | **Spec**: [./spec.md](./spec.md)

## Summary

Implement the `/loop` slash command to schedule recurring prompts. The command will use the `CronCreate` tool to schedule recurring tasks based on user input. It will also immediately execute the prompt once and provide a confirmation message with cancellation instructions.

## Technical Context

**Language/Version**: TypeScript (Strict)
**Primary Dependencies**: `agent-sdk` (Cron tools), `code` (CLI interface), `cron-parser` (for background scheduling)
**Storage**: In-memory session store (managed by `CronCreate`)
**Testing**: Vitest
**Target Platform**: Node.js (CLI)
**Project Type**: pnpm monorepo
**Performance Goals**: Standard CLI responsiveness
**Constraints**: 1-minute cron granularity, 7-day auto-expiration, thundering herd prevention (avoiding :00/:30)
**Scale/Scope**: Single slash command integration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic will be placed in `packages/agent-sdk` as a built-in skill.
- [x] **TypeScript Excellence**: All new code will use strict TypeScript.
- [x] **Test Alignment**: Unit and integration tests will be added to `packages/agent-sdk/tests`.
- [x] **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` will be used for validation.
- [x] **Data Model Minimalism**: Using existing `CronCreate` parameters; no new complex entities.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/072-loop-slash-command/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command) - USER FACING
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── CronCreate.md
│   ├── CronDelete.md
│   └── CronList.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── builtin-skills/
│   │   └── loop/
│   │       └── SKILL.md
│   ├── managers/
│   │   └── cronManager.ts
│   ├── tools/
│   │   ├── cronCreateTool.ts
│   │   ├── cronDeleteTool.ts
│   │   └── cronListTool.ts
│   └── index.ts (register tools/manager)
└── tests/
    ├── managers/
    │   └── cronManager.test.ts
    └── tools/
        ├── cronCreateTool.test.ts
        ├── cronDeleteTool.test.ts
        └── cronListTool.test.ts
```

**Structure Decision**: Monorepo structure with logic in `agent-sdk`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |

