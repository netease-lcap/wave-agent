# Implementation Plan: Confirm UI

**Branch**: `034-confirm-ui` | **Status**: Implemented | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/034-confirm-ui/spec.md`

## Summary

Implement a confirmation UI system that prompts users to approve sensitive operations (Bash, Write, Edit, ExitPlanMode, AskUserQuestion) before execution. The system uses a two-component architecture (`ConfirmationDetails` for display, `ConfirmationSelector` for interaction) with queue-based processing for sequential confirmations. Special handling exists for AskUserQuestion flows with multi-question support and "Other" custom input.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Ink (React for CLI), React hooks
**State Management**: React state via useChat context
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Terminal CLI)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Immediate UI response, no flicker during interaction
**Constraints**: Must handle terminal overflow gracefully with static mode
**Scale/Scope**: Core UI component for all restricted tool confirmations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: UI in `code` package, types in `agent-sdk`. Pass.
2. **TypeScript Excellence**: Strong typing for PermissionDecision and state interfaces. Pass.
3. **Test Alignment**: Unit tests for components, integration tests for flow. Pass.
4. **Build Dependencies**: `agent-sdk` types must be built for `code` to use. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec/plan/research/data-model/quickstart. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: Components in `packages/code/src/components/`. Pass.
8. **Data Model Minimalism**: Simple state interfaces. Pass.

## Project Structure

### Documentation (this feature)

```
specs/034-confirm-ui/
├── plan.md              # This file
├── research.md          # Design decisions
├── data-model.md        # State entities
├── quickstart.md        # User guide
├── contracts/           # API contracts
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       └── types/
│           └── permissions.ts    # PermissionDecision, ToolPermissionContext
└── code/
    ├── src/
    │   ├── components/
    │   │   ├── ConfirmationDetails.tsx
    │   │   ├── ConfirmationSelector.tsx
    │   │   ├── DiffDisplay.tsx
    │   │   └── PlanDisplay.tsx
    │   └── contexts/
    │       └── useChat.tsx       # Confirmation state management
    └── tests/
        └── components/
            ├── ConfirmationDetails.test.tsx
            └── ConfirmationSelector.test.tsx
```

**Structure Decision**: UI components in `code` package, shared types in `agent-sdk`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
