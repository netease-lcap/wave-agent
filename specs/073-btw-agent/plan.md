# Implementation Plan: btwAgent

**Branch**: `073-btw-agent` | **Date**: 2026-03-20 | **Spec**: [./spec.md]

**Input**: Feature specification from `./spec.md`

## Summary

The `btwAgent` feature will be implemented as a specialized subagent within the `code` package, leveraging the existing `SubagentManager` in `agent-sdk`. It will provide a non-intrusive way for users to ask quick questions about the codebase or current context without interrupting the main agent's task queue. The `btwAgent` and the main agent will run concurrently, allowing the user to query the `btwAgent` while the main agent continues its background work. Crucially, `/btw` commands will bypass the main agent's message queue and be processed immediately, even if the main agent is busy.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`, `code` (React Ink)
**Storage**: N/A (Transient session)
**Testing**: Vitest, HookTester
**Target Platform**: CLI
**Project Type**: Monorepo (pnpm)
**Performance Goals**: < 500ms for agent initialization
**Constraints**: Isolated `MessageManager` and `AIManager`, same tools and system prompt as main agent.
**Scale/Scope**: Single-session, one-off query.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: `btwAgent` logic will be integrated into `code` package, using `agent-sdk`'s `SubagentManager`.
- [x] **TypeScript Excellence**: Strict type checking will be maintained.
- [x] **Test Alignment**: Unit and integration tests will be added to `packages/code/tests`.
- [x] **Build Dependencies**: `pnpm build` will be run after any `agent-sdk` changes.
- [x] **Documentation Minimalism**: Only `quickstart.md` and internal spec/plan files are created.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` will be run.
- [x] **Source Code Structure**: Logic will be placed in `useChat.tsx` (context) and UI components.
- [x] **Test-Driven Development**: Critical logic in `useChat.tsx` will be tested.
- [x] **Type System Evolution**: `ChatContextType` will be extended.
- [x] **Data Model Minimalism**: `BtwAgentState` is kept concise.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning.
- [x] **User-Centric Quickstart**: `quickstart.md` is written for end-users.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/073-btw-agent/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
│   └── btw-agent.md
└── tasks.md             # Phase 2 output (to be created)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       └── managers/
│           └── aiManager.ts      # Add getSystemPrompt()
└── code/
    └── src/
        ├── constants/
        │   └── commands.ts       # Add /btw command
        ├── contexts/
        │   └── useChat.tsx       # Main logic for btwAgent
        └── components/
            └── ChatInterface.tsx # UI for btwAgent mode
```

**Structure Decision**: The feature will be implemented across `agent-sdk` (for the system prompt getter) and `code` (for the command, state, and UI).

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
