# Implementation Plan: Plugin Support

**Branch**: `042-plugin`
**Status**: Unified Implementation Plan

## Summary
The goal is to provide a unified plugin support system for Wave. This includes support for local plugins, expanded plugin capabilities (Skills, LSP, MCP, Hooks, Agents), and plugin scope management. The technical approach involves:
1.  Defining a standard plugin structure (using `.wave-plugin/plugin.json`).
2.  Implementing a plugin loading mechanism in the SDK with filesystem-based discovery.
3.  Supporting multiple component types (Skills, LSP, MCP, Hooks, Agents, Commands).
4.  Managing plugin installation scopes (`user`, `project`, `local`) and enabling/disabling plugins via `settings.json`.
5.  Providing an interactive CLI management interface.

## Technical Context
- **Language/Version**: TypeScript (Strict mode)
- **Primary Dependencies**: `agent-sdk`, `code` (CLI), `pnpm`, `vitest`
- **Storage**: Local filesystem (plugin directories, `.wave-plugin/plugin.json`, `settings.json`)
- **Testing**: Vitest (unit and integration tests)
- **Target Platform**: Linux/macOS/Windows (Node.js environment)
- **Performance Goals**: Fast plugin loading and command execution (<100ms).

## Constitution Check
1.  **Package-First Architecture**: Logic in `agent-sdk`, CLI in `code`.
2.  **TypeScript Excellence**: Strict typing for all new code.
3.  **Test Alignment**: Tests in `packages/agent-sdk/tests` and `packages/code/tests`.
4.  **Documentation Minimalism**: Unified spec and plan files.
5.  **Data Model Minimalism**: Concise plugin and manifest models.

## Project Structure

### Documentation
```
specs/042-plugin/
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
│   │   ├── managers/    # PluginManager, SkillManager, HookManager
│   │   ├── services/    # PluginLoader, ConfigurationService
│   │   └── types/       # Plugin types, WaveConfiguration
└── code/
    ├── src/
    │   ├── cli.tsx      # --plugin-dir flag
    │   └── commands/    # CLI command implementations (enable, disable, install)
```

## Complexity Tracking
*No violations identified.*
