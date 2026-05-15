# Implementation Plan: Custom Tools via buildTool()

**Branch**: `077-custom-tools` | **Status**: Planned | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/077-custom-tools/spec.md`

## Summary

Add a `buildTool()` factory function and `customTools` option to `Agent.create()` so SDK users can define and register custom tools alongside built-in tools. Tools respect the existing whitelist, permission rules, and deferred loading system.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: openai (for ChatCompletionFunctionTool type)
**Testing**: Vitest (Unit tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Constraints**: Must not modify built-in tool behavior; custom tools are opt-in via Agent.create()
**Scale/Scope**: New factory function + small changes to AgentOptions, ToolManager, containerSetup, and exports

## Constitution Check

1. **Package-First Architecture**: Logic in `agent-sdk` (new `buildTool.ts`), integration in existing managers. Pass.
2. **TypeScript Excellence**: Strict typing for `ToolDef` and `ToolPlugin`. Pass.
3. **Test Alignment**: Unit tests for `buildTool()` factory covering all options. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before `code` can use. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec structure. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: `buildTool.ts` in `agent-sdk/src/tools/`. Pass.
8. **Data Model Minimalism**: Simple data structures — ToolDef, ToolPlugin. Pass.

## Project Structure

### Documentation (this feature)

```
specs/077-custom-tools/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── buildTool.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── tools/
│   │   │   ├── buildTool.ts              # NEW: ToolDef + buildTool() factory
│   │   │   └── types.ts                  # (unchanged — ToolPlugin already exists)
│   │   ├── types/
│   │   │   └── agent.ts                  # Add customTools?: ToolPlugin[]
│   │   ├── managers/
│   │   │   └── toolManager.ts            # Accept customTools, register in initializeBuiltInTools()
│   │   ├── utils/
│   │   │   └── containerSetup.ts         # Pass customTools to ToolManager
│   │   └── index.ts                      # Export buildTool, ToolPlugin, ToolResult, ToolContext
│   └── tests/
│       └── tools/
│           └── buildTool.test.ts         # NEW: Unit tests for buildTool()
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
