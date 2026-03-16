# Implementation Plan: ACP Bridge

**Branch**: `070-acp-bridge` | **Date**: 2026-03-16 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `./spec.md`

## Summary

The goal is to implement an ACP (Agent Control Protocol) bridge for Wave Agent, allowing external clients (like IDE plugins) to interact with the agent over `stdin`/`stdout` using NDJSON. This bridge will translate ACP JSON-RPC messages into Wave Agent SDK calls and vice versa.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22+
**Primary Dependencies**: @agentclientprotocol/sdk, wave-agent-sdk
**Storage**: Session files in the working directory.
**Testing**: Vitest
**Target Platform**: CLI (Linux/macOS/Windows)
**Project Type**: Monorepo (packages/code, packages/agent-sdk)
**Performance Goals**: Low-latency message passing and streaming updates.
**Constraints**: Must handle connection closure gracefully; must support tool permissions.
**Scale/Scope**: Medium-sized feature addition to the CLI package.

## Constitution Check

- [x] **Package-First Architecture**: Bridge logic is in `packages/code/src/acp/`, using `agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing for all ACP-related classes and interfaces.
- [x] **Test Alignment**: Unit tests for the bridge logic and integration tests for ACP communication.
- [x] **Build Dependencies**: `agent-sdk` must be built before `code`.
- [x] **Documentation Minimalism**: No extra markdown docs except those required by the spec.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test` will be run.
- [x] **Source Code Structure**: Follows existing patterns in `packages/code/src/acp/`.
- [x] **Test-Driven Development**: Tests will be written alongside implementation.
- [x] **Type System Evolution**: Existing types will be extended if necessary.
- [x] **Data Model Minimalism**: Only essential session and tool call state will be tracked.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning; subagents for implementation.
- [x] **User-Centric Quickstart**: `quickstart.md` will focus on how to use the ACP bridge.

## Project Structure

### Documentation (this feature)

```
specs/070-acp-bridge/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
└── code/
    └── src/
        ├── acp/
        │   ├── index.ts       # Entry point for ACP CLI
        │   └── agent.ts       # WaveAcpAgent implementation
        └── index.ts           # CLI entry point integration
```

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
