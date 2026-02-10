# Implementation Plan: Ctrl-B Background Tool

**Branch**: `062-ctrl-b-background-tool` | **Date**: 2026-02-10 | **Spec**: [specs/062-ctrl-b-background-tool/spec.md](spec.md)
**Input**: Feature specification from `/specs/062-ctrl-b-background-tool/spec.md`

## Summary
Implement a hotkey (Ctrl-B) in the Wave CLI to move a currently running foreground tool (Bash or Task) to the background. The technical approach involves intercepting Ctrl-B in `InputManager`, triggering a backgrounding method in the `Agent`, which transitions the active process/task to the background system established in `061` without aborting it.

## Technical Context

**Language/Version**: TypeScript 5.x  
**Primary Dependencies**: React Ink, wave-agent-sdk  
**Storage**: N/A (Session-based)  
**Testing**: Vitest (Unit and Integration)  
**Target Platform**: Linux/macOS (CLI)
**Project Type**: Monorepo (agent-sdk + code)  
**Performance Goals**: Immediate UI response to Ctrl-B (<100ms)  
**Constraints**: Must not affect direct user bash commands (`!command`)  
**Scale/Scope**: Small feature extending existing background task system

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Package-First Architecture**: PASS. Changes are split between `agent-sdk` (logic) and `code` (UI/Input).
- **II. TypeScript Excellence**: PASS. Strict typing will be maintained.
- **III. Test Alignment**: PASS. Unit tests for `InputManager` and integration tests for `Agent` backgrounding logic are planned.
- **IV. Build Dependencies**: PASS. `agent-sdk` will be built before testing in `code`.
- **V. Documentation Minimalism**: PASS. Only necessary spec/plan files created.
- **VI. Quality Gates**: PASS. `type-check` and `lint` will be run.
- **VII. Source Code Structure**: PASS. Follows manager/hook patterns. Handoff mechanism will be implemented in managers.
- **VIII. Test-Driven Development**: PASS. Tests will be written for the backgrounding logic.
- **IX. Type System Evolution**: PASS. Existing `Agent` and `ToolContext` types will be evolved.
- **X. Data Model Minimalism**: PASS. Simple `ForegroundTask` tracking added.
- **XI. Planning with General-Purpose Agent**: PASS. General-purpose agent used for all phases.

## Project Structure

### Documentation (this feature)

```
specs/062-ctrl-b-background-tool/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── agent.ts             # Track foreground task, backgroundCurrentTask()
│       ├── managers/
│       │   ├── backgroundTaskManager.ts # Support for detaching/adopting processes and tasks
│       │   └── subagentManager.ts   # Support for transitioning active subagents to background
│       └── tools/
│           ├── bashTool.ts      # Register background handler, return backgrounded result
│           └── taskTool.ts      # Register background handler, return backgrounded result
└── code/
    └── src/
        ├── managers/
        │   └── InputManager.ts  # Intercept Ctrl-B
        ├── hooks/
        │   └── useChat.tsx      # Connect InputManager to Agent
        └── components/
            └── InputBox.tsx     # Pass callbacks
```

**Structure Decision**: Monorepo structure with clear separation between SDK logic and CLI interface.

## Complexity Tracking

*No violations detected.*
