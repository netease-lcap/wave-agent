# Implementation Plan: Init Slash Command

**Branch**: `054-init-slash-command` | **Date**: 2026-01-27 | **Spec**: [/specs/054-init-slash-command/spec.md]

## Summary

The `/init` slash command will be implemented as a built-in command in `SlashCommandManager`. When triggered, it will send a specialized `INIT_PROMPT` (hardcoded in `prompts.ts`) to the AI agent. The agent will then use its existing file system tools to analyze the repository and generate or update an `AGENTS.md` file in the root directory, following the guidelines provided in the prompt.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk`, `openai` (via `AIManager`)
**Storage**: Filesystem (`AGENTS.md`)
**Testing**: Vitest
**Target Platform**: CLI
**Project Type**: Monorepo (Package-based)
**Performance Goals**: Analysis should complete within reasonable AI response time (seconds to a minute).
**Constraints**: Must respect existing rule files and mandatory prefix.
**Scale/Scope**: Repository-wide analysis.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Package-First Architecture: Changes are within `agent-sdk`.
- [x] TypeScript Excellence: Strict typing will be used.
- [x] Test Alignment: Unit tests for `SlashCommandManager` and `prompts`.
- [x] Build Dependencies: `pnpm build` required for `agent-sdk`.
- [x] Documentation Minimalism: No extra docs created beyond spec/plan.
- [x] Quality Gates: `type-check` and `lint` will be run.
- [x] Source Code Structure: Follows `managers` and `constants` patterns.
- [x] Test-Driven Development: Tests will be written for the new command.
- [x] Type System Evolution: Existing `SlashCommand` interface will be used.
- [x] Data Model Minimalism: Simple `AGENTS.md` structure.

## Project Structure

### Documentation (this feature)

```
specs/054-init-slash-command/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── init-command.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/src/
├── managers/
│   └── slashCommandManager.ts  # Register /init command
└── constants/
    └── prompts.ts              # Add INIT_PROMPT
```

**Structure Decision**: Single project (monorepo package `agent-sdk`).
