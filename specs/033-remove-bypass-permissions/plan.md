# Implementation Plan: Remove Bypass Permissions from Shift+Tab

**Branch**: `033-remove-bypass-permissions` | **Date**: 2025-12-26 | **Spec**: [/specs/033-remove-bypass-permissions/spec.md](/specs/033-remove-bypass-permissions/spec.md)

**Input**: Feature specification from `/specs/033-remove-bypass-permissions/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The primary requirement is to remove the "Bypass Permissions" mode from the `Shift+Tab` keyboard shortcut cycle in the `InputManager`. The shortcut will now only toggle between "Default" and "Accept Edits" modes. If the system is currently in "Bypass Permissions" mode, pressing `Shift+Tab` will transition it back to "Default".

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `ink`, `wave-agent-sdk`
**Storage**: N/A (State is in-memory in `InputManager`)
**Testing**: Vitest
**Target Platform**: Linux/macOS (CLI)
**Project Type**: Monorepo (Packages: `code`, `agent-sdk`)
**Performance Goals**: Instant UI response to keyboard shortcut
**Constraints**: Must maintain type safety and follow existing `InputManager` patterns
**Scale/Scope**: Small modification to `InputManager.ts` and associated tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Changes are localized to `packages/code` and `packages/agent-sdk` (if type changes needed).
- [x] **TypeScript Excellence**: Strict typing will be maintained.
- [x] **Test Alignment**: Tests will be added/updated in `packages/code/tests/managers/InputManager.permissionMode.test.ts`.
- [x] **Build Dependencies**: `pnpm build` will be run if `agent-sdk` types are modified.
- [x] **Documentation Minimalism**: No extra markdown docs beyond required spec/plan files.
- [x] **Quality Gates**: `pnpm run type-check` and `pnpm run lint` will be executed.
- [x] **Source Code Structure**: Follows existing `InputManager` patterns.
- [x] **Test-Driven Development**: Will update existing tests to reflect new behavior.
- [x] **Type System Evolution**: Evaluated. `PermissionMode` type remains unchanged to maintain SDK compatibility, but the cycling logic is restricted.
- [x] **Data Model Minimalism**: Confirmed. No new entities added, just a simplified state transition table.

## Project Structure

### Documentation (this feature)

```
specs/033-remove-bypass-permissions/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       └── types/
│           └── permissions.ts  # PermissionMode type definition
└── code/
    ├── src/
    │   └── managers/
    │       └── InputManager.ts # Keyboard shortcut logic
    └── tests/
        └── managers/
            └── InputManager.permissionMode.test.ts # Tests for permission mode cycling
```

**Structure Decision**: Monorepo structure with changes in `packages/code` for logic and `packages/agent-sdk` for types if necessary.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

