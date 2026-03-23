# Implementation Plan: /btw Side Question

**Branch**: `073-btw-side-question` | **Date**: 2026-03-23 | **Spec**: [./spec.md]

**Input**: Feature specification from `./spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The `/btw` side question feature allows users to ask quick questions or explore the codebase without interrupting the main agent's current task. This is achieved by launching a separate side agent instance (using the `Explore` configuration) asynchronously using the `BtwManager` in `agent-sdk`. The side agent inherits all messages from the main conversation to provide full context. The UI in the `code` package will switch to a dedicated message list for the side agent and provide a "Side agent is thinking... | Esc to dismiss" indicator to return to the main conversation.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: React Ink, Vitest, agent-sdk
**Storage**: N/A (Side agent messages are transient or stored in memory)
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Linux/macOS/Windows (CLI)
**Project Type**: Monorepo (agent-sdk and code packages)
**Performance Goals**: Side agent should launch and respond within standard LLM latency limits without impacting main agent performance.
**Constraints**: Side agent uses Explore configuration. Main agent MUST NOT be interrupted.
**Scale/Scope**: Multi-turn side questions with access to conversation history.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Feature spans `agent-sdk` (logic) and `code` (UI).
- [x] **TypeScript Excellence**: Strict typing will be used for all new state and functions.
- [x] **Test Alignment**: Unit tests for `BtwManager` and `SubagentManager` integration; integration tests for UI switching.
- [x] **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
- [x] **Documentation Minimalism**: Only necessary spec and plan files created.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` will be run.
- [x] **Source Code Structure**: Follows established patterns for managers, services, and components.
- [x] **Type System Evolution**: Existing `SubagentConfiguration` and `ChatState` will be extended.
- [x] **Data Model Minimalism**: Minimal state added to `useChat` for side agent tracking.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning.
- [x] **User-Centric Quickstart**: `quickstart.md` will focus on how to use `/btw`.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/073-btw-side-question/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command) - USER FACING
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   ├── btwManager.ts           # Handle side agent lifecycle
│   │   │   └── subagentManager.ts      # Handle side agent execution
│   │   └── agent.ts                    # Expose btw() and dismissSideAgent()
│   └── tests/
│       └── managers/
│           └── btwManager.test.ts
└── code/
    ├── src/
    │   ├── components/
    │   │   ├── ChatInterface.tsx       # Conditional MessageList rendering
    │   │   └── LoadingIndicator.tsx    # Show side agent thinking status
    │   ├── App.tsx                     # Handle UI remount on side agent activation
    │   └── contexts/
    │       └── useChat.tsx             # State for sideMessages and btw()
    └── tests/
        └── components/
            └── ChatInterface.test.tsx
```

**Structure Decision**: Monorepo structure with changes in `agent-sdk` for core logic and `code` for UI integration.

## Technical Implementation Requirements

- **TIR-001**: The Agent SDK MUST expose a `btw()` function that handles the side agent's logic via `BtwManager`.
- **TIR-002**: The CLI MUST integrate the `/btw` command into the `useChat.tsx` context in `@packages/code/src/contexts/`.
- **TIR-003**: The CLI MUST invoke the `btw()` function from the Agent SDK when the user types the `/btw` command.
- **TIR-004**: The CLI MUST support multi-turn follow-up questions within the side agent view.
- **TIR-005**: The CLI MUST ensure a clean UI reset when activating or dismissing the side agent.

