# Implementation Plan: Modular Memory Rules

**Branch**: `053-modular-rules` | **Date**: 2026-01-27 | **Spec**: [/specs/053-modular-rules/spec.md](./spec.md)

## Summary

The "Modular Memory Rules" feature enables organizing agent instructions into multiple Markdown files within `.wave/rules/` (project-level) and `~/.wave/rules/` (user-level). It supports path-specific scoping via YAML frontmatter, discovery (limited to immediate subdirectories), and symlink resolution. The technical approach involves implementing a `MemoryRuleManager` in `agent-sdk` to discover, parse, and filter memory rules based on the current task context (files in context window).

## Technical Context

**Language/Version**: TypeScript 5.x  
**Primary Dependencies**: `agent-sdk`, `minimatch` (for glob matching)  
**Storage**: Filesystem (`.wave/rules/`, `~/.wave/rules/`)  
**Testing**: Vitest  
**Target Platform**: Node.js (CLI)
**Project Type**: Monorepo (agent-sdk + code)  
**Performance Goals**: Memory rule discovery and matching should add <50ms to agent startup/context refresh.  
**Constraints**: Must handle circular symlinks; must prioritize project memory rules over user memory rules.  
**Scale/Scope**: Support for dozens of memory rule files and complex glob patterns.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic will be placed in `agent-sdk` (managers/services) and exposed to `code`.
- [x] **TypeScript Excellence**: Strict typing for memory rule definitions and frontmatter.
- [x] **Test Alignment**: Unit tests in `packages/agent-sdk/tests` and integration tests in `packages/code/tests`.
- [x] **Build Dependencies**: `pnpm build` required after `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` mandatory.
- [x] **Data Model Minimalism**: `MemoryRule` entity is lean, containing only necessary fields for identification and content.
- [x] **Documentation Minimalism**: No unnecessary markdown files created; only required spec/plan artifacts.
- [x] **Type System Evolution**: Will extend `AgentOptions` and internal types rather than creating redundant ones.


## Project Structure

### Documentation (this feature)

```
specs/053-modular-rules/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/src/
├── managers/
│   └── MemoryRuleManager.ts    # Discovery and lifecycle of memory rules
├── services/
│   └── MemoryRuleService.ts    # Parsing and glob matching logic
├── types.ts                    # MemoryRule and Frontmatter types
└── agent.ts                    # Integration of MemoryRuleManager into agent loop
```

**Structure Decision**: Logic resides in `agent-sdk` to allow reuse and maintain clear separation between core agent capabilities and the CLI implementation.

## Complexity Tracking

*N/A - No violations identified.*
