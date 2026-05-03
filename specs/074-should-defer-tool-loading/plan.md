# Implementation Plan: Deferred Tool Loading (shouldDefer)

**Branch**: `074-should-defer-tool-loading` | **Date**: 2026-05-03 | **Spec**: [./spec.md](./spec.md)

## Summary

Implement a deferred tool loading system where tools marked with `shouldDefer: true` are excluded from the initial API call. The model discovers deferred tools via `ToolSearch`, which returns full schemas. Once discovered, tools are included in subsequent API calls. MCP tools are auto-deferred. This saves context tokens by only loading tools the model actually needs.

## Technical Context

**Language/Version**: TypeScript (Strict)
**Primary Dependencies**: `agent-sdk` (tool system, AI manager)
**Storage**: In-memory Set tracking discovered tools per session
**Testing**: Vitest
**Target Platform**: Node.js (CLI)
**Project Type**: pnpm monorepo
**Performance Goals**: Minimal overhead — tool filtering is O(n) per API call
**Constraints**: Tool discovery must persist across turns; ToolSearch must always be available
**Scale/Scope**: Core tool loading mechanism affecting all API calls

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic placed in `packages/agent-sdk`.
- [x] **TypeScript Excellence**: All new code uses strict TypeScript.
- [x] **Test Alignment**: Unit and integration tests added to `packages/agent-sdk/tests`.
- [x] **Build Dependencies**: `pnpm build` run after `agent-sdk` changes.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` used for validation.
- [x] **Data Model Minimalism**: Using a simple Set for discovered tools; no new complex entities.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/074-should-defer-tool-loading/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command) - USER FACING
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── tool-search.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── tools/
│   │   ├── types.ts                     # ToolPlugin interface (shouldDefer, alwaysLoad, isMcp)
│   │   └── toolSearchTool.ts            # ToolSearch implementation
│   ├── utils/
│   │   └── isDeferredTool.ts            # Helper to determine if a tool is deferred
│   ├── managers/
│   │   ├── toolManager.ts               # Filters deferred tools based on discovered set
│   │   └── aiManager.ts                 # Tracks discovered tools across turns
│   └── prompts/
│       └── index.ts                     # Lists deferred tool names in system prompt
└── tests/
    ├── tools/
    │   └── shouldDefer.test.ts          # ToolSearch and isDeferredTool tests
    └── managers/
        └── shouldDefer.test.ts          # ToolManager filtering and prompt tests
```

**Structure Decision**: Monorepo with logic in `agent-sdk`. New types extend existing `ToolPlugin` interface; no new files needed for type definitions.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
