# Implementation Plan: Secure File Access

**Branch**: `047-secure-file-access` | **Date**: 2026-01-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/047-secure-file-access/spec.md`

## Summary

Implement a "Safe Zone" for file operations to prevent unauthorized modifications outside the project directory. The Safe Zone includes the current working directory and any paths specified in `permissions.additionalDirectories`. File operations within the Safe Zone can be auto-accepted in `acceptEdits` mode, while operations outside the Safe Zone always require explicit user confirmation.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`, `code`
**Storage**: Filesystem
**Testing**: Vitest
**Target Platform**: Linux, macOS, Windows
**Project Type**: Monorepo
**Performance Goals**: Minimal overhead on file operations
**Constraints**: Must resolve symlinks to real paths for security checks
**Scale/Scope**: Intercepts Write, Edit, MultiEdit, and Delete tools

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Changes will be primarily in `agent-sdk` (logic) and `code` (if UI needs update).
2. **TypeScript Excellence**: Strict typing will be used for new configuration fields.
3. **Test Alignment**: New tests will be added to `packages/agent-sdk/tests/managers/permissionManager.test.ts`.
4. **Build Dependencies**: `pnpm build` will be run after modifying `agent-sdk`.
5. **Documentation Minimalism**: Only necessary spec files are created.
6. **Quality Gates**: `pnpm run type-check` and `pnpm run lint` will be run.
7. **Source Code Structure**: Logic will be placed in `PermissionManager`.
8. **Test-Driven Development**: Will write tests for the new permission logic.
9. **Type System Evolution**: `WaveConfiguration` and `PermissionManagerOptions` will be extended.
10. **Data Model Minimalism**: Only `additionalDirectories` field is added.

## Project Structure

### Documentation (this feature)

```
specs/047-secure-file-access/
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
│   ├── src/
│   │   ├── managers/
│   │   │   └── permissionManager.ts  # Main logic update
│   │   ├── types/
│   │   │   └── hooks.ts              # Configuration type update
│   │   └── utils/
│   │       └── pathSafety.ts         # Existing utility
│   └── tests/
│       └── managers/
│           └── permissionManager.test.ts # New tests
└── code/
    └── src/
        └── managers/
            └── InputManager.ts       # Verify if any changes needed for UI
```

**Structure Decision**: Monorepo structure as established. Logic resides in `agent-sdk`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

