# Implementation Plan: LSP Integration Support

**Branch**: `039-lsp-integration-support` | **Date**: 2025-12-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/039-lsp-integration-support/spec.md`

## Summary

Implement LSP (Language Server Protocol) support to provide the agent with advanced code intelligence. This involves creating an `LspManager` to handle server processes and an `lsp` tool to expose operations like `goToDefinition`, `hover`, and `findReferences`.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: Node.js `child_process`, JSON-RPC
**Storage**: `.lsp.json` configuration file
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk)
**Performance Goals**: Low-latency communication with LSP servers
**Constraints**: Stdio-based communication; manual message framing
**Scale/Scope**: Core code intelligence capability for the agent

## Constitution Check

- [x] **Package-First Architecture**: `LspManager` and `lsp` tool in `agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing for LSP protocol and configurations.
- [x] **Test Alignment**: Unit tests for manager and tool logic.
- [x] **Build Dependencies**: Minimal dependencies; manual JSON-RPC implementation.
- [x] **Quality Gates**: Passes linting and type-checking.
- [x] **Test-Driven Development**: Tests written for core LSP operations.
- [x] **Type System Evolution**: New types for LSP configurations and processes.
- [x] **Data Model Minimalism**: Focused on necessary LSP subset.

## Project Structure

### Documentation (this feature)

```
specs/039-lsp-integration-support/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── lspManager.ts       # Server lifecycle and RPC
│   ├── tools/
│   │   └── lspTool.ts          # Agent-facing tool
│   └── types/
│       └── lsp.ts              # LSP-related types
└── tests/
    ├── managers/
    │   └── lspManager.test.ts
    └── tools/
        └── lspTool.test.ts
```

## Complexity Tracking

*No violations*
