# Implementation Plan: Split Chained Bash Commands for Permissions

**Branch**: `036-split-bash-commands` | **Date**: 2025-12-27 | **Spec**: [spec.md](./spec.md)

## Summary

The goal is to improve the permission management for chained bash commands. When a user chooses to "Don't ask again" for a command like `cmd1 && cmd2`, the system will split it into `cmd1` and `cmd2`, filter out safe commands (like `cd`), and save the remaining non-safe commands to the `permissions.allow` list. This ensures granular permissions and avoids cluttering the configuration with safe commands.

## Technical Context

**Language/Version**: TypeScript (strict mode)
**Primary Dependencies**: `agent-sdk`
**Storage**: `settings.local.json` (via `ConfigurationService`)
**Testing**: `vitest`
**Target Platform**: Node.js
**Project Type**: Monorepo
**Performance Goals**: Minimal overhead for permission checks
**Constraints**: Must handle complex bash syntax (pipes, subshells, redirections) correctly.
**Scale/Scope**: Modifying `PermissionManager` and `Agent` in `agent-sdk`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Package-First Architecture: Changes are confined to `agent-sdk`.
- [x] TypeScript Excellence: Strict typing will be used.
- [x] Test Alignment: New tests will be added to `permissionManager.test.ts`.
- [x] Build Dependencies: `pnpm build` will be run after changes.
- [x] Documentation Minimalism: Only necessary spec/plan/research files.
- [x] Quality Gates: `type-check` and `lint` will be run.
- [x] Source Code Structure: Following existing manager/service patterns.
- [x] Data Model Minimalism: No new entities, just refined rule strings.

## Project Structure

### Documentation (this feature)

```
specs/036-split-bash-commands/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── permissionManager.ts  # Add splitting and filtering logic
│   ├── utils/
│   │   └── bashParser.ts        # Re-use existing utilities
│   └── agent.ts                 # Update addPermissionRule to use splitting
└── tests/
    └── managers/
        └── permissionManager.test.ts # Add tests for chained commands
```

**Structure Decision**: Single project (agent-sdk) as this is a core logic improvement.


## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

