# Implementation Plan: Support permissions.deny in settings.json

**Branch**: `049-deny-permissions-support` | **Date**: 2026-01-15 | **Spec**: [/specs/049-deny-permissions-support/spec.md]

## Summary

Implement a `permissions.deny` field in `settings.json` that allows users to explicitly forbid specific tools, bash commands, or file paths. Deny rules will have the highest precedence in the permission system, ensuring that any denied action is blocked regardless of other allow rules or auto-accept modes.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`, `minimatch` (for glob matching in rules)
**Storage**: `settings.json`, `settings.local.json`
**Testing**: `vitest`
**Target Platform**: Node.js
**Project Type**: Monorepo (pnpm)
**Performance Goals**: Sub-millisecond overhead for permission checks.
**Constraints**: Must support hot-reloading and merging from multiple config sources.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Package-First Architecture**: PASS. Changes are within `agent-sdk`.
- **II. TypeScript Excellence**: PASS. Strict typing will be maintained.
- **III. Test Alignment**: PASS. Tests will be added to existing test suites.
- **IV. Build Dependencies**: PASS. `pnpm build` will be run.
- **V. Documentation Minimalism**: PASS. Only necessary spec/plan files created.
- **VI. Quality Gates**: PASS. `type-check` and `lint` will be run.
- **VII. Source Code Structure**: PASS. Follows manager/service pattern.
- **VIII. Test-Driven Development**: PASS. New tests will cover the feature.
- **IX. Type System Evolution**: PASS. Existing interfaces will be extended.
- **X. Data Model Minimalism**: PASS. Simple string array for deny rules.

## Project Structure

### Documentation (this feature)

```
specs/049-deny-permissions-support/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── spec.md              # Feature specification
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── permissionManager.ts    # Update checkPermission, add matchesRule
│   ├── services/
│   │   └── configurationService.ts # Update merging and validation
│   ├── tools/
│   │   ├── readTool.ts             # Add checkPermission call
│   │   └── lsTool.ts               # Add checkPermission call
│   └── types/
│       ├── configuration.ts        # Update WaveConfiguration
│       └── permissions.ts          # Update PermissionManagerOptions
└── tests/
    ├── managers/
    │   └── permissionManager.test.ts
    └── services/
        └── configurationService.test.ts
```

**Structure Decision**: Single project (monorepo package). Changes are focused on `agent-sdk`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

