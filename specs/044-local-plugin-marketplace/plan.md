# Implementation Plan: Local Plugin Marketplace

**Branch**: `044-local-plugin-marketplace` | **Date**: 2026-01-13 | **Spec**: [./spec.md]
**Input**: Feature specification from `/specs/044-local-plugin-marketplace/spec.md`

## Summary

The primary requirement is to support local plugin marketplaces by allowing users to add local directories as marketplaces, install plugins from them, and manage installed plugins. The technical approach involves:
1.  Defining a directory structure in `~/.wave` for marketplace metadata and installed plugin snapshots.
2.  Implementing CLI commands for `wave plugin marketplace add` and `wave plugin install`.
3.  Managing a `known_marketplaces.json` and `installed_plugins.json` to track state.
4.  Copying plugin files to a local cache during installation to ensure stability.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `agent-sdk`, `code` (CLI)
**Storage**: Local filesystem (`~/.wave/plugins/`)
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (Package-First Architecture)
**Performance Goals**: Plugin installation and command discovery should be near-instant (< 500ms).
**Constraints**: Must follow the directory structure specified in user input (using `.wave` instead of `.claude`).
**Scale/Scope**: Support for multiple marketplaces and dozens of installed plugins.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1.  **Package-First Architecture**: Does this feature respect package boundaries? (Yes, logic in `agent-sdk`, CLI in `code`)
2.  **TypeScript Excellence**: Is strict typing planned? (Yes)
3.  **Test Alignment**: Are tests planned for `packages/*/tests`? (Yes)
4.  **Documentation Minimalism**: Are we avoiding unnecessary MD files? (Yes, only required spec/plan artifacts)
5.  **Data Model Minimalism**: Is the marketplace/plugin model concise? (Yes)

## Project Structure

### Documentation (this feature)

```
specs/044-local-plugin-marketplace/
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
│       ├── managers/
│       │   └── PluginManager.ts (Update to handle marketplaces)
│       ├── services/
│       │   └── MarketplaceService.ts (New: Handle marketplace IO)
│       └── types.ts (Update with Marketplace/Plugin types)
└── code/
    └── src/
        └── commands/
            └── plugin/ (New: CLI commands for marketplace/install)
```

**Structure Decision**: Following the established monorepo pattern with logic in `agent-sdk` and CLI interface in `code`.

## Complexity Tracking

*No violations identified.*
