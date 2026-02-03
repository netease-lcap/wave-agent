# Implementation Plan: General-Purpose Agent

**Branch**: `058-general-purpose-agent` | **Date**: 2026-02-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/058-general-purpose-agent/spec.md`

## Summary

The goal is to implement a built-in "general-purpose" subagent in the Wave Agent system. This subagent will be optimized for multi-step research and implementation tasks, complementing the existing read-only `Explore` subagent. It will have full tool access (`*`) and a specific system prompt defining its operational guidelines (broad-to-narrow search, absolute paths, no proactive docs, no emojis).

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `agent-sdk` (core logic)
**Storage**: N/A (Stateless subagent configuration)
**Testing**: Vitest (Unit and Integration tests required)
**Target Platform**: Node.js (CLI environment)
**Project Type**: Monorepo (Package-first architecture)
**Performance Goals**: Fast initialization and efficient tool execution
**Constraints**: Must follow Wave Agent Constitution (absolute paths, no proactive docs, no emojis)
**Scale/Scope**: Built-in subagent available to all users via the `Task` tool

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: YES. Implementation will be within `packages/agent-sdk`.
2. **TypeScript Excellence**: YES. Strict typing will be used for subagent configuration.
3. **Test Alignment**: YES. Both unit and integration tests will be added to `packages/agent-sdk/tests`.
4. **Documentation Minimalism**: YES. No new `.md` files will be created outside of the `specs/` directory.
5. **Quality Gates**: YES. `pnpm run type-check` and `pnpm lint` will be run.
6. **Data Model Minimalism**: YES. Using existing `SubagentConfiguration` interface.

## Project Structure

### Documentation (this feature)

```
specs/058-general-purpose-agent/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   └── utils/
│       └── builtinSubagents.ts  # Registration of the new subagent
└── tests/
    ├── utils/
    │   └── builtinSubagents.test.ts  # Unit tests
    └── integration/
        └── taskTool.builtin.test.ts  # Integration tests
```

**Structure Decision**: Following the established `agent-sdk` pattern for built-in subagents.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
