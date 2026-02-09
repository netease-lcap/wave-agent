# Implementation Plan: Plugin Scope Management

**Branch**: `045-plugin-scope-management` | **Date**: 2026-01-13 | **Spec**: [specs/045-plugin-scope-management/spec.md](./spec.md)
**Input**: Feature specification from `/specs/045-plugin-scope-management/spec.md`

## Summary

The primary requirement is to support enabling and disabling plugins at different scopes (`user`, `project`, `local`) and to support scoped installation. This will be achieved by:
    1. Extending `MarketplaceService` to handle `enabledPlugins` in `settings.json` and reference-counted uninstallation via `projectPath`.
    2. Updating `PluginManager` to respect the `enabledPlugins` configuration across all scopes with proper priority (`local` > `project` > `user`).
    3. Adding `enable` and `disable` commands to the `wave plugin` CLI.
    4. Updating the `install` and `uninstall` commands to support the `--scope` option and manage project-specific references.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`, `code` (CLI), `fs-extra` (or native `fs/promises`)
**Storage**: JSON files (`settings.json`, `settings.local.json`)
**Testing**: Vitest
**Target Platform**: Node.js (Linux/macOS/Windows)
**Project Type**: Monorepo (Packages: `agent-sdk`, `code`)
**Performance Goals**: Minimal overhead during plugin loading (caching of enabled state if necessary).
**Constraints**: Must maintain backward compatibility with existing plugin loading logic.
**Scale/Scope**: Affects all plugin-related operations in the CLI and SDK.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: YES. Logic will be split between `agent-sdk` (services/managers) and `code` (CLI commands).
2. **TypeScript Excellence**: YES. Strict typing will be used for new configuration fields.
3. **Test Alignment**: YES. Tests will be placed in `packages/*/tests`.
4. **Build Dependencies**: YES. `agent-sdk` will be built before testing `code`.
5. **Documentation Minimalism**: YES. No extra MD docs beyond required spec/plan artifacts.
6. **Quality Gates**: YES. `type-check` and `lint` will be run.
7. **Source Code Structure**: YES. Following manager/service/utils pattern.
8. **Data Model Minimalism**: YES. `enabledPlugins` is a simple flat mapping.
9. **Type System Evolution**: YES. `WaveConfiguration` is evolved rather than creating a new config type.
10. **Data Model Minimalism (Re-check)**: YES. Using `Record<string, boolean>` is the minimal way to support both enabling and explicit disabling across scopes.

## Project Structure

### Documentation (this feature)

```
specs/045-plugin-scope-management/
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
    │   │   ├── services/
    │   │   │   ├── MarketplaceService.ts  # Update to handle enabledPlugins and reference counting
    │   │   │   └── configurationService.ts # Update to load enabledPlugins
    │   │   ├── managers/
    │   │   │   └── PluginManager.ts       # Update to filter by enabledPlugins
    │   │   └── types/
    │   │       ├── marketplace.ts         # Update types (InstalledPlugin with projectPath)
    │   │       └── hooks.ts               # Update WaveConfiguration type
│   └── tests/
│       ├── services/
│       └── managers/
└── code/
    ├── src/
    │   └── commands/
    │       └── plugin/
    │           ├── enable.ts          # New command
    │           ├── disable.ts         # New command
    │           └── install.ts         # Update command
    └── tests/
        └── commands/
```

**Structure Decision**: Monorepo structure with logic in `agent-sdk` and CLI in `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
