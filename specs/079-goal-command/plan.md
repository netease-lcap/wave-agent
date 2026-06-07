# Implementation Plan: /goal Command

**Branch**: `079-goal-command` | **Date**: 2026-06-07 | **Spec**: [./spec.md](./spec.md)

## Summary

Implement the `/goal` slash command to set an autonomous completion condition for the session. The agent works across turns without user input, using the fast model to evaluate the goal after each turn. Circuit breakers prevent runaway execution.

## Technical Context

**Language/Version**: TypeScript (Strict)
**Primary Dependencies**: `agent-sdk` (GoalManager, aiService), `code` (CLI status line)
**Storage**: In-memory GoalState, session metadata for persistence
**Testing**: Vitest
**Target Platform**: Node.js (CLI)
**Project Type**: pnpm monorepo
**Performance Goals**: Fast model evaluation (<2s per eval), no UI flicker between turns
**Constraints**: Max 50 turns, 30 min duration, 3 consecutive eval failures
**Scale/Scope**: Single slash command, one manager, one AI service function

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic in `packages/agent-sdk`, UI in `packages/code`.
- [x] **TypeScript Excellence**: All new code uses strict TypeScript.
- [x] **Test Alignment**: Unit tests in `packages/agent-sdk/tests/goalManager.test.ts`.
- [x] **Build Dependencies**: `pnpm build` after agent-sdk changes.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm test` for validation.
- [x] **Data Model Minimalism**: Single `GoalState` interface, one persistence field.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test` to validate.

## Project Structure

### Documentation (this feature)

```
specs/079-goal-command/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
│   ├── GoalManager.md
│   └── evaluateGoal.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── goalManager.ts        # GoalManager class
│   ├── constants/
│   │   └── goalPrompts.ts        # Evaluator system prompt
│   ├── services/
│   │   └── aiService.ts          # + evaluateGoal() function
│   ├── managers/
│   │   ├── aiManager.ts          # + goal eval in finally block
│   │   └── slashCommandManager.ts # + /goal command, /clear integration
│   ├── utils/
│   │   └── containerSetup.ts     # + register GoalManager
│   ├── agent.ts                  # + goalManager exposure, callback
│   ├── types/
│   │   ├── agent.ts              # + onGoalStateChange callback
│   │   ├── core.ts               # + "goal_evaluation" operation_type
│   └── services/
│       ├── session.ts            # + goalCondition in SessionData
│       └── initializationService.ts # + restore goal on startup
└── tests/
    └── goalManager.test.ts

packages/code/
├── src/
│   ├── components/
│   │   ├── StatusLine.tsx        # + goal indicator
│   │   ├── InputBox.tsx          # + thread goal props
│   │   └── ChatInterface.tsx     # + pass goal state
│   └── contexts/
│       └── useChat.tsx           # + goal state + callback

packages/agent-sdk/
└── examples/
    └── goal-demo.ts              # Example script
```

**Structure Decision**: Monorepo structure with logic in `agent-sdk`, UI in `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
