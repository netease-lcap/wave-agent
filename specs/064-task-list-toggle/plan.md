# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The Task List Toggle feature introduces a keyboard shortcut (`Ctrl+T`) to show or hide a task list at the bottom of the message list in the CLI. This provides users with a persistent but toggleable view of background tasks managed by the agent. The implementation leverages the existing `InputManager` for shortcut handling and the `TaskManager` component for rendering task data from the `ChatContext`.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: React Ink, wave-agent-sdk
**Storage**: N/A (UI state only; task data persisted by agent-sdk)
**Testing**: Vitest, HookTester
**Target Platform**: CLI (Terminal)
**Project Type**: Monorepo (packages/code)
**Performance Goals**: Instant toggle response (<50ms)
**Constraints**: Must not interfere with existing shortcuts (Ctrl+O, Ctrl+B, etc.)
**Scale/Scope**: UI component integration in `packages/code`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Changes are isolated to `packages/code`.
- [x] **TypeScript Excellence**: Strict typing will be used for new state and handlers.
- [x] **Test Alignment**: Unit tests for `InputManager` and integration tests for `MessageList` toggle.
- [x] **Build Dependencies**: `agent-sdk` build not required as no SDK changes are planned.
- [x] **Documentation Minimalism**: Only `quickstart.md` and `spec.md` created as requested.
- [x] **Quality Gates**: `pnpm run type-check` and `pnpm test` will be run.
- [x] **Source Code Structure**: Follows `managers`, `hooks`, and `components` patterns.
- [x] **Test-Driven Development**: Tests will be written for the toggle logic.
- [x] **Type System Evolution**: Reusing `BackgroundTask` types from `agent-sdk`.
- [x] **Data Model Minimalism**: Minimal UI state added to `InputManager`.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/064-task-list-toggle/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── checklists/          # Quality checklists
│   └── requirements.md
└── spec.md              # Feature specification
```

### Source Code (repository root)

```
packages/code/src/
├── managers/
│   └── InputManager.ts      # Add Ctrl+T handler
├── hooks/
│   └── useInputManager.ts   # Expose toggle state
├── components/
│   ├── MessageList.tsx      # Integrate TaskManager
│   └── TaskManager.tsx      # Ensure compatibility with toggle
└── contexts/
    └── useChat.tsx          # Source of task data
```

**Structure Decision**: Option 1 (Single project) within `packages/code`.


## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

