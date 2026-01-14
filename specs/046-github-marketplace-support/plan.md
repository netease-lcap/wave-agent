# Implementation Plan: GitHub Marketplace Support

**Branch**: `046-github-marketplace-support` | **Date**: 2026-01-14 | **Spec**: [/specs/046-github-marketplace-support/spec.md](/specs/046-github-marketplace-support/spec.md)
**Input**: Feature specification from `/specs/046-github-marketplace-support/spec.md`

## Summary

The goal is to extend the Wave Agent's plugin marketplace system to support GitHub repositories as marketplace sources. This includes adding marketplaces using the `owner/repo` format, and providing an `update` command to refresh marketplace manifests. The technical approach involves using `~/.wave/plugins/marketplaces/` as a persistent local mirror for GitHub marketplaces. Marketplaces will be cloned into this directory, and `git pull` will be used for updates. The `known_marketplaces.json` registry will be updated to use a structured `source` object to distinguish between local directories and GitHub repositories. All plugin sources within a marketplace are expected to be relative paths.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `agent-sdk`, `git` CLI, `vitest`
**Storage**: Local filesystem for marketplace manifests and cloned plugin repositories.
**Testing**: Vitest (unit and integration tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: CLI / Monorepo
**Performance Goals**: Marketplace listing should be near-instant (using cache); updates and installs should be limited by network/git speed.
**Constraints**: Must handle GitHub rate limits, network failures, and invalid repository structures.
**Scale/Scope**: Support for multiple concurrent marketplaces (local and remote).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Implementation will be split between `agent-sdk` (core logic) and `code` (CLI commands).
2. **TypeScript Excellence**: All new code will use strict TypeScript.
3. **Test Alignment**: Tests will be placed in `packages/agent-sdk/tests` and `packages/code/tests`.
4. **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
5. **Documentation Minimalism**: Only `plan.md`, `research.md`, `data-model.md`, and `quickstart.md` will be created.
6. **Quality Gates**: `pnpm run type-check` and `pnpm lint` will be run before completion.
7. **Data Model Minimalism**: Marketplace and Plugin entities will be kept as simple as possible, following the existing patterns.

## Project Structure

### Documentation (this feature)

```
specs/046-github-marketplace-support/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── checklists/          # Quality checklists
    └── requirements.md
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── marketplace/ # Marketplace management logic
│   │   └── plugin/      # Plugin installation logic
│   └── tests/
└── code/
    ├── src/
    │   └── commands/    # CLI command implementations
    └── tests/
```

**Structure Decision**: Following the existing monorepo structure. Core logic goes into `agent-sdk`, and CLI interface goes into `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
