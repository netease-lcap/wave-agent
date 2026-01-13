# Implementation Plan: Local Plugin Support

**Branch**: `042-local-plugin-support` | **Date**: 2026-01-13 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/042-local-plugin-support/spec.md`

## Summary

The primary requirement is to enable the `agent-sdk` and the `code` CLI to support local plugins. This involves defining a standard plugin structure (using `.wave-plugin/plugin.json`), implementing a plugin loading mechanism in the SDK, and adding a `--plugin-dir` flag to the CLI. The technical approach will focus on filesystem-based discovery and namespaced command registration.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: `agent-sdk`, `code` (CLI), `pnpm`, `vitest`
**Storage**: Local filesystem (plugin directories, `.wave-plugin/plugin.json`)
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (SDK + CLI)
**Performance Goals**: Fast plugin loading and command execution (<100ms)
**Constraints**: Must use `.wave-plugin` directory name, namespaced commands
**Scale/Scope**: Support multiple local plugins

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Changes will be isolated to `agent-sdk` (core logic) and `code` (CLI interface).
- [x] **TypeScript Excellence**: All new code will use strict TypeScript.
- [x] **Test Alignment**: Tests will be placed in `packages/agent-sdk/tests` and `packages/code/tests`.
- [x] **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
- [x] **Documentation Minimalism**: No extra documentation files will be created.
- [x] **Quality Gates**: `pnpm run type-check` and `pnpm run lint` will be executed.
- [x] **Source Code Structure**: Plugin management logic will be in `agent-sdk/src/managers`.
- [x] **Data Model Minimalism**: Plugin and Manifest entities will be kept simple.

## Project Structure

### Documentation (this feature)

```
specs/042-local-plugin-support/
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
│   │   ├── managers/    # PluginManager
│   │   ├── services/    # PluginLoader
│   │   └── types.ts     # Plugin types
│   └── tests/
└── code/
    ├── src/
    │   ├── cli.tsx      # --plugin-dir flag
    │   └── index.ts     # yargs configuration
    └── tests/
```

**Structure Decision**: Monorepo structure with clear separation between SDK (logic) and CLI (interface).

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
