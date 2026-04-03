# Implementation Plan: /model Command

**Branch**: `033-model-command` | **Status**: Completed | **Date**: 2026-01-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/033-model-command/spec.md`

## Summary

Implement a `/model` builtin command that allows users to interactively switch between configured AI models within the CLI. This involves adding model configuration methods to the SDK and creating an interactive `ModelSelector` UI component.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Ink (for CLI UI)
**Storage**: settings.json for persistent configuration
**Testing**: Vitest (Unit tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Instant UI response (< 50ms for selector open/close)
**Constraints**: Session-level switching only, no persistence to settings.json
**Scale/Scope**: UI enhancement affecting model selection

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Logic split between `agent-sdk` (managers/services) and `code` (UI). Pass.
2. **TypeScript Excellence**: Strict typing for model configurations. Pass.
3. **Test Alignment**: Unit tests for SDK configuration methods. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before `code` can use new methods. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec/plan/research/data-model/quickstart. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: Configuration methods in `services`, UI in `components`. Pass.
8. **Data Model Minimalism**: Simple `ModelConfig` and `ModelEntry` types. Pass.

## Project Structure

### Documentation (this feature)

```
specs/033-model-command/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── model-selection-interfaces.md
│   └── model-selection.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── services/
│   │   │   └── configurationService.ts
│   │   ├── types/
│   │   │   └── agent.ts
│   │   └── agent.ts
│   └── tests/
│       └── services/
│           └── configurationService.test.ts
└── code/
    ├── src/
    │   ├── managers/
    │   │   ├── inputReducer.ts
    │   │   └── inputHandlers.ts
    │   ├── hooks/
    │   │   └── useInputManager.ts
    │   ├── contexts/
    │   │   └── useChat.tsx
    │   ├── components/
    │   │   ├── ModelSelector.tsx
    │   │   └── InputBox.tsx
    │   └── index.tsx
    └── tests/
        └── managers/
            └── inputReducer.test.ts
```

**Structure Decision**: Monorepo structure following existing patterns. Configuration logic in `agent-sdk` for reuse and UI in `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
