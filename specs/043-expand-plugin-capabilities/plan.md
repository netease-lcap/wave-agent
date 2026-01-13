# Implementation Plan: Expand Plugin Capabilities

**Branch**: `043-expand-plugin-capabilities` | **Date**: 2026-01-13 | **Spec**: [/specs/043-expand-plugin-capabilities/spec.md]

## Summary

The goal is to expand the plugin system to support a wider range of components, including Agent Skills, LSP servers, MCP servers, and Hooks. This will be achieved by enhancing the `PluginLoader` to discover these components based on a standardized directory structure and updating the `PluginManager` to register them with their respective runtime managers.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, @modelcontextprotocol/sdk
**Storage**: Filesystem (plugin directories)
**Testing**: Vitest
**Target Platform**: Node.js
**Project Type**: SDK / CLI
**Performance Goals**: Plugin loading should be fast (< 500ms for typical plugins)
**Constraints**: Must maintain backward compatibility with existing slash command plugins.
**Scale/Scope**: Support for 6 component types across local plugins.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: All changes are within `agent-sdk`. (Pass)
2. **TypeScript Excellence**: Strict typing will be used for new plugin interfaces. (Pass)
3. **Test Alignment**: New tests will be added to `packages/agent-sdk/tests/services/pluginLoader.test.ts` and `pluginManager.test.ts`. (Pass)
4. **Documentation Minimalism**: Only necessary quickstart and internal docs created. (Pass)
5. **Data Model Minimalism**: Plugin and Manifest entities are kept concise. (Pass)

## Project Structure

### Documentation (this feature)

```
specs/043-expand-plugin-capabilities/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── plugin-system.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   ├── pluginManager.ts
│   │   ├── skillManager.ts
│   │   └── hookManager.ts
│   ├── services/
│   │   └── pluginLoader.ts
│   ├── types/
│   │   └── plugins.ts
│   └── utils/
│       └── skillParser.ts
└── tests/
    ├── services/
    │   └── pluginLoader.test.ts
    └── managers/
        └── pluginManager.test.ts
```

**Structure Decision**: Monorepo package structure (agent-sdk).

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
