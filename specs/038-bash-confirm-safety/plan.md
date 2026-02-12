# Implementation Plan: Bash Confirmation Safety

**Branch**: `038-bash-confirm-safety` | **Date**: 2025-12-27 | **Spec**: [/specs/038-bash-confirm-safety/spec.md](./spec.md)

## Summary

The primary requirement is to prevent the "Don't ask again" option from appearing in the bash confirmation dialog for dangerous commands or commands that operate outside the project's working directory. 

Technical approach:
1.  Enhance `agent-sdk`'s `PermissionManager` to identify dangerous/out-of-bounds commands.
2.  Add a `hidePersistentOption` flag to `ToolPermissionContext`.
3.  Update the `code` package's `Confirmation` component to respect this flag.
4.  Enforce safety in `PermissionManager.expandBashRule` to prevent persistence of dangerous rules.

## Technical Context

**Language/Version**: TypeScript
**Primary Dependencies**: `agent-sdk`, `code` (Ink)
**Storage**: `settings.local.json` (via `ConfigurationService`)
**Testing**: Vitest
**Target Platform**: Linux
**Project Type**: Monorepo
**Performance Goals**: Negligible impact on command evaluation time.
**Constraints**: Must not allow persistence of dangerous commands even if requested by the UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Package-First Architecture: Changes span `agent-sdk` and `code`.
- [x] TypeScript Excellence: Strict typing for new context field.
- [x] Test Alignment: New tests in `packages/agent-sdk/tests` and `packages/code/tests`.
- [x] Build Dependencies: `pnpm build` required for `agent-sdk` changes.
- [x] Documentation Minimalism: No extra markdown docs beyond spec/plan.
- [x] Quality Gates: `pnpm run type-check` and `pnpm lint` will be run.
- [x] Source Code Structure: Follows existing manager/component patterns.
- [x] Test-Driven Development: Will add tests for dangerous command detection.
- [x] Type System Evolution: Extending `ToolPermissionContext`.
- [x] Data Model Minimalism: Single boolean flag added.

## Project Structure

### Documentation (this feature)

```
specs/038-bash-confirm-safety/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── permission-context.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   └── permissionManager.ts
│   │   ├── types/
│   │   │   └── permissions.ts
│   │   └── utils/
│   │       ├── bashParser.ts
│   │       └── pathSafety.ts
│   └── tests/
│       └── managers/
│           └── permissionManager.test.ts
└── code/
    ├── src/
    │   └── components/
    │       └── Confirmation.tsx
    └── tests/
        └── components/
            └── Confirmation.test.tsx
```

**Structure Decision**: Standard monorepo structure with changes in `agent-sdk` (logic) and `code` (UI).

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | | |
