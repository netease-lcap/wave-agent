# Implementation Plan: Builtin Settings Skill

**Branch**: `071-builtin-settings-skill` | **Date**: 2026-03-18 | **Spec**: [./spec.md]
**Input**: Feature specification from `./spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The primary requirement is to support a builtin `settings` skill that guides users on how to write `settings.json` and helps them manage their configuration. The technical approach involves:
1.  Creating a `builtin-skills` directory in `agent-sdk`.
2.  Updating `SkillManager` to discover skills from this directory.
3.  Implementing the `settings` skill as a markdown file with detailed instructions and examples.
4.  Providing separate documentation for complex configurations in `HOOKS.md`, `ENV.md`, `MCP.md`, `MEMORY_RULES.md`, `SKILLS.md`, and `SUBAGENTS.md`.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: `agent-sdk`, `pnpm`
**Storage**: `settings.json`, `settings.local.json` (filesystem)
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (pnpm)
**Performance Goals**: Fast configuration loading and updates (<100ms)
**Constraints**: Must follow `agent-sdk` configuration patterns.
**Scale/Scope**: Builtin skill in `agent-sdk`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Package-First Architecture**: Skill is in `agent-sdk` as a core feature.
- **TypeScript Excellence**: Strict TS, no `any`.
- **Test Alignment**: Unit and integration tests in `packages/*/tests`.
- **Build Dependencies**: `pnpm build` after `agent-sdk` changes.
- **Documentation Minimalism**: Only `SKILL.md` and `HOOKS.md` as requested.
- **Quality Gates**: `type-check`, `lint`, `test:coverage`.
- **Source Code Structure**: `services` for IO, `types.ts` for types.
- **Test-Driven Development**: Required for critical functionality.
- **Type System Evolution**: Evolve `WaveConfiguration` if needed.
- **Data Model Minimalism**: Keep `WaveConfiguration` focused.
- **Planning and Task Delegation**: Use general-purpose agent (me) and subagents.
- **User-Centric Quickstart**: `quickstart.md` for end-users.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/071-builtin-settings-skill/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command) - USER FACING
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

**Note on quickstart.md**: This file MUST be written for the end-user (CLI/SDK user). Do not include developer-specific setup instructions. Focus on "How to use this feature".

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── builtin-skills/
│   │   └── settings/
│   │       ├── SKILL.md
│   │       ├── HOOKS.md
│   │       ├── ENV.md
│   │       ├── MCP.md
│   │       ├── MEMORY_RULES.md
│   │       ├── SKILLS.md
│   │       └── SUBAGENTS.md
│   ├── managers/
│   │   └── skillManager.ts
│   ├── services/
│   │   └── configurationService.ts
│   ├── types/
│   │   ├── configuration.ts
│   │   └── skills.ts
│   └── utils/
│       └── configPaths.ts
└── tests/
    ├── managers/
    │   └── skillManager.test.ts
    └── services/
        └── configurationService.test.ts
```

**Structure Decision**: The feature is implemented as a core part of `agent-sdk`, with the skill content stored in a new `builtin-skills` directory.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | | |
