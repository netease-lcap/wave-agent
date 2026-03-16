# Implementation Plan: Support AskUserQuestion Tool

**Branch**: `052-ask-user-tool` | **Date**: 2026-01-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/052-ask-user-tool/spec.md`

## Summary

Implement the `AskUserQuestion` tool to allow the agent to ask structured multiple-choice questions for clarification and decision-making. This involves creating a new built-in tool in `agent-sdk` and updating the `Confirmation` component in `code` to render the interactive questioning UI. The tool MUST NOT be available in `bypassPermissions` mode.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: N/A
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Instant UI response for user input
**Constraints**: Max 4 questions, 2-4 options per question; MUST NOT be available in `bypassPermissions` mode.
**Scale/Scope**: Built-in tool available to all agent sessions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Tool in `agent-sdk`, UI in `code`.
- [x] **TypeScript Excellence**: Strict typing for tool schema and UI props.
- [x] **Test Alignment**: Unit tests for tool logic, integration tests for full flow.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for tool execution first.
- [x] **Type System Evolution**: Extend `PermissionDecision` if needed, or use existing `toolInput` patterns.
- [x] **Data Model Minimalism**: Concise schema for questions and answers.

## Project Structure

### Documentation (this feature)

```
specs/052-ask-user-tool/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── tool-schema.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── tools/
│   │   └── askUserQuestion.ts  # New tool implementation
│   ├── managers/
│   │   └── toolManager.ts      # Register new tool
│   └── types/
│       └── permissions.ts      # Add to RESTRICTED_TOOLS
└── tests/
    ├── tools/
    │   └── askUserQuestion.test.ts
    └── integration/
        └── askUserQuestion.integration.test.ts

packages/code/
├── src/
│   └── components/
│       └── Confirmation.tsx    # Update to handle AskUserQuestion UI
└── tests/
    └── components/
        └── Confirmation.test.tsx
```

**Structure Decision**: Monorepo structure following existing patterns in `agent-sdk` and `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

