# Implementation Plan: Plugin Marketplace and Management UI

**Branch**: `044-plugin-marketplace`
**Status**: Unified Implementation Plan

## Summary
The goal is to provide a unified plugin marketplace and management system for Wave. This includes support for local, GitHub, and builtin marketplaces, as well as an interactive CLI management interface. The technical approach involves:
1.  Defining a directory structure in `~/.wave` for marketplace metadata and installed plugin snapshots.
2.  Implementing core services in `agent-sdk` for marketplace and plugin management.
3.  Injecting a builtin marketplace (`wave-plugins-official`) by default.
4.  Supporting GitHub and Git-based marketplaces using `git clone` and `git pull`.
5.  Providing an interactive Ink-based CLI interface for discovery, installation, and management.

## Technical Context
- **Language/Version**: TypeScript (Strict mode)
- **Primary Dependencies**: `agent-sdk`, `code` (CLI), `git` CLI, `vitest`
- **Storage**: Local filesystem (`~/.wave/plugins/`)
- **Testing**: Vitest (unit and integration tests)
- **Target Platform**: Linux/macOS/Windows (Node.js environment)
- **Performance Goals**: Plugin installation and command discovery should be near-instant (< 500ms).

## Constitution Check
1.  **Package-First Architecture**: Logic in `agent-sdk`, CLI in `code`.
2.  **TypeScript Excellence**: Strict typing for all new code.
3.  **Test Alignment**: Tests in `packages/agent-sdk/tests` and `packages/code/tests`.
4.  **Documentation Minimalism**: Unified spec and plan files.
5.  **Data Model Minimalism**: Concise marketplace and plugin models.

## Project Structure

### Documentation
```
specs/044-plugin-marketplace/
├── spec.md              # Unified specification
├── research.md          # Consolidated research
├── plan.md              # This file
├── data-model.md        # Unified data model
├── tasks.md             # Combined task list
├── quickstart.md        # Comprehensive quickstart guide
├── contracts/           # Consolidated contracts
└── checklists/          # Quality checklists
```

### Source Code
```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── services/
│   │   │   ├── MarketplaceService.ts  # Marketplace and plugin IO
│   │   │   └── GitService.ts          # Git operations
│   │   ├── managers/
│   │   │   └── PluginManager.ts       # Plugin loading and management
│   │   └── types/
│   │       └── marketplace.ts         # Type definitions
└── code/
    ├── src/
    │   ├── components/
    │   │   └── PluginManager/         # Ink-based UI components
    │   ├── hooks/
    │   │   └── usePluginManager.ts    # UI state and logic hook
    │   └── commands/
    │       └── plugin/                # CLI command implementations
```

## Complexity Tracking
*No violations identified.*
