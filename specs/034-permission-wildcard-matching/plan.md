# Implementation Plan: Permission Prefix Matching

**Branch**: `034-permission-prefix-matching` | **Date**: 2025-12-26 | **Spec**: [/specs/034-permission-prefix-matching/spec.md](/specs/034-permission-prefix-matching/spec.md)
**Input**: Feature specification from `/specs/034-permission-prefix-matching/spec.md`

## Summary

Implement prefix matching for permission rules in `PermissionManager`. Rules ending with `:*` will match any tool call that starts with the preceding string. This provides a flexible way to allow groups of related commands without using complex regex or wildcards.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`
**Storage**: N/A
**Testing**: Vitest
**Target Platform**: Linux
**Project Type**: Monorepo
**Performance Goals**: Minimal overhead for permission checks.
**Constraints**: No regex, no wildcards except `:*` at the end.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Rationale |
|-----------|--------|-----------|
| I. Package-First Architecture | PASS | Logic change is contained within `agent-sdk`. |
| II. TypeScript Excellence | PASS | Strict typing will be maintained. |
| III. Test Alignment | PASS | Tests will be added to `packages/agent-sdk/tests`. |
| IV. Build Dependencies | PASS | `pnpm build` will be run after modifying `agent-sdk`. |
| V. Documentation Minimalism | PASS | No unnecessary documentation files created. |
| VI. Quality Gates | PASS | `type-check` and `lint` will be run. |
| VII. Source Code Structure | PASS | Modifying existing `PermissionManager`. |
| X. Data Model Minimalism | PASS | Using simple string patterns for rules. |

## Project Structure

### Documentation (this feature)

```
specs/034-permission-prefix-matching/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Quality checklist
└── spec.md              # Feature specification
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   └── managers/
│       └── permissionManager.ts  # Core logic change
└── tests/
    └── managers/
        └── permissionManager.test.ts  # New tests
```

**Structure Decision**: Modifying `PermissionManager` in `agent-sdk` as it is the central authority for permission checks.

## Complexity Tracking

*No violations identified.*
