# Implementation Plan: Plugin Support and Marketplace

**Branch**: `035-plugin`
**Status**: Complete

## Summary
The goal is to provide a unified plugin support system and marketplace for Wave. This includes support for local plugins, expanded plugin capabilities (Skills, LSP, MCP, Hooks, Agents), plugin scope management, and a marketplace ecosystem for discovery and installation. The technical approach involves:
1.  Defining a standard plugin structure (using `.wave-plugin/plugin.json`).
2.  Implementing a plugin loading mechanism in the SDK with filesystem-based discovery.
3.  Supporting multiple component types (Skills, LSP, MCP, Hooks, Agents, Commands).
4.  Managing plugin installation scopes (`user`, `project`, `local`) and enabling/disabling plugins via `settings.json`.
5.  Defining a directory structure in `~/.wave` for marketplace metadata and installed plugin snapshots.
6.  Implementing core services in `agent-sdk` for marketplace and plugin management.
7.  Injecting a builtin marketplace (`wave-plugins-official`) by default.
8.  Supporting GitHub and Git-based marketplaces using `git clone --depth 1` and `git pull`. No direct HTTP file download.
9.  Providing a `PluginCore` high-level API for all plugin and marketplace operations.
10. Providing an interactive Ink-based CLI interface for discovery, installation, and management.

## Technical Context
- **Language/Version**: TypeScript (Strict mode)
- **Primary Dependencies**: `agent-sdk`, `code` (CLI), `git` CLI, `pnpm`, `vitest`
- **Storage**: Local filesystem (plugin directories, `.wave-plugin/plugin.json`, `settings.json`, `~/.wave/plugins/`)
- **Remote Fetching**: All via `git clone --depth 1` (shallow clone). GitHub shorthand resolved to `https://github.com/owner/repo.git`. No direct HTTP download.
- **Testing**: Vitest (unit and integration tests)
- **Target Platform**: Linux/macOS/Windows (Node.js environment)
- **Performance Goals**: Fast plugin loading and command execution (<100ms). Plugin installation and command discovery should be near-instant (< 500ms).
- **Git Timeout**: Default 120s, configurable via `WAVE_PLUGIN_GIT_TIMEOUT_MS`.

## Constitution Check
1.  **Package-First Architecture**: Logic in `agent-sdk`, CLI in `code`.
2.  **TypeScript Excellence**: Strict typing for all new code.
3.  **Test Alignment**: Tests in `packages/agent-sdk/tests` and `packages/code/tests`.
4.  **Documentation Minimalism**: Unified spec and plan files.
5.  **Data Model Minimalism**: Concise plugin, manifest, and marketplace models.

## Project Structure

### Documentation
```
specs/035-plugin/
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
│   │   ├── core/        # PluginCore — high-level API for all plugin/marketplace operations
│   │   ├── managers/    # PluginManager, PluginScopeManager, SkillManager, HookManager
│   │   ├── services/    # PluginLoader, ConfigurationService, MarketplaceService, GitService, InitializationService
│   │   └── types/       # Plugin types, WaveConfiguration, Marketplace types (discriminated union)
└── code/
    ├── src/
    │   ├── cli.tsx      # --plugin-dir flag
    │   ├── components/  # PluginManager/ (Ink-based UI components)
    │   ├── hooks/       # usePluginManager.ts
    │   └── commands/    # CLI command implementations (enable, disable, install, marketplace)
```

## Complexity Tracking
*No violations identified.*
