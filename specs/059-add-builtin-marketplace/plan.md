# Implementation Plan: Add Builtin Marketplace

**Branch**: `059-add-builtin-marketplace` | **Date**: 2026-02-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/059-add-builtin-marketplace/spec.md`

## Summary

The primary requirement is to provide a builtin marketplace (`wave-plugins-official`) by default in the Wave CLI. This ensures users have immediate access to official plugins without manual configuration. The technical approach involves injecting the default marketplace definition into the `MarketplaceService` in `agent-sdk`. If no user configuration exists, the service will return the builtin marketplace. If the user adds or removes marketplaces, the configuration will be persisted to `known_marketplaces.json`, allowing the builtin marketplace to be managed like any other.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `agent-sdk` (MarketplaceService), `fs-extra`
**Storage**: `~/.wave/plugins/known_marketplaces.json`
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Cross-platform (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Minimal impact on CLI startup time (<50ms for marketplace resolution)
**Constraints**: Must be removable by the user; must handle deduplication.
**Scale/Scope**: Single builtin marketplace initially.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Package-First Architecture**: Changes are primarily in `agent-sdk` with CLI exposure in `code`.
- **TypeScript Excellence**: Strict typing for `KnownMarketplace` and `MarketplaceSource`.
- **Test Alignment**: Unit tests for `MarketplaceService` and integration tests for CLI commands.
- **Documentation Minimalism**: Only necessary spec and plan files created.
- **Data Model Minimalism**: Evolving existing `KnownMarketplace` type.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning.

## Project Structure

### Documentation (this feature)

```
specs/059-add-builtin-marketplace/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── marketplace-service.md
└── tasks.md             # Phase 2 output (to be created)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── services/
│       │   └── MarketplaceService.ts  # Main logic for builtin injection
│       └── types/
│           └── marketplace.ts         # Type definitions
└── code/
    └── src/
        └── commands/
            └── plugin/
                └── marketplace.ts     # CLI command verification
```

**Structure Decision**: Standard monorepo structure. Logic resides in `agent-sdk` services, exposed via `code` CLI commands.

## Complexity Tracking

*No violations identified.*
