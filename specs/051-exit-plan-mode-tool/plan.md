# Implementation Plan: ExitPlanMode Tool

**Branch**: `051-exit-plan-mode-tool` | **Date**: 2026-01-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/051-exit-plan-mode-tool/spec.md`

## Summary

Add an `ExitPlanMode` tool that allows the agent to signal completion of the planning phase. This tool will trigger a user confirmation (reusing `canUseTool`) with three options: Default execution, Accept Edits mode, or providing Feedback. The tool will only be available when the agent is in "plan mode" and will display the contents of the plan file to the user for review. It MUST NOT be available in `bypassPermissions` mode.

**Technical Approach**:
- Implement `ExitPlanMode` tool in `agent-sdk` that reads the plan file and calls `permissionManager.canUseTool`.
- Update `ToolManager` in `agent-sdk` to filter `ExitPlanMode` based on `permissionMode`.
- Update `Agent` in `agent-sdk` to register the new tool.
- Update `ToolResultDisplay` component in `code` to render `planContent` from `ToolBlock` using the `Markdown` component.
- Update `ExitPlanMode` tool to inject `planContent` via `updateToolBlock` before calling `checkPermission`.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `agent-sdk`, `code`, `vitest`
**Storage**: Files (Plan file storage)
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Linux/Node.js
**Project Type**: Monorepo (TypeScript)
**Performance Goals**: Instant UI response for confirmation prompt.
**Constraints**: MUST reuse `canUseTool` mechanism; MUST only be visible in plan mode; MUST NOT be available in `bypassPermissions` mode.
**Scale/Scope**: Single tool implementation with state transition and UI integration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Will modify `agent-sdk` for tool logic and `code` for UI confirmation.
2. **TypeScript Excellence**: All new code will be strictly typed.
3. **Test Alignment**: Unit tests for tool logic and integration tests for the full flow are required.
4. **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
5. **Documentation Minimalism**: No extra markdown files beyond those required by the process.
6. **Quality Gates**: `pnpm run type-check` and `pnpm lint` will be run.
7. **Source Code Structure**: Tool logic in `agent-sdk/src/tools`, UI in `code/src/components`.
8. **Test-Driven Development**: Will write failing tests for the 3-option confirmation first.
9. **Type System Evolution**: Will extend `canUseTool` related types to support multiple options.
10. **Data Model Minimalism**: Will use existing plan state if possible.

## Project Structure

### Documentation (this feature)

```
specs/051-exit-plan-mode-tool/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── tools/       # ExitPlanMode tool definition
│       └── agent.ts     # Toolset management logic
└── code/
    └── src/
        ├── components/  # Confirmation UI with 3 options
        └── hooks/       # Tool usage hooks
```

**Structure Decision**: Monorepo structure with `agent-sdk` for core logic and `code` for CLI/UI.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
