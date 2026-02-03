# Implementation Plan: Plugin Interactive UI

**Branch**: `060-plugin-interactive-ui` | **Date**: 2026-02-03 | **Spec**: [/specs/060-plugin-interactive-ui/spec.md](spec.md)
**Input**: Feature specification from `/specs/060-plugin-interactive-ui/spec.md`

## Summary

The primary requirement is to provide an interactive CLI UI for managing plugins (list, install, remove, update) and marketplaces. The technical approach involves creating a new React Ink component `PluginManagerUI` in `packages/code`, registering a `/plugin` slash command locally within the `code` package (via `CommandSelector.tsx`) to trigger it, and leveraging existing services in `packages/agent-sdk` (`MarketplaceService`, `ConfigurationService`) for the backend logic. This ensures the interactive UI is specific to the CLI frontend and does not conflict with other potential frontends.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: React Ink, wave-agent-sdk
**Storage**: Local files (`~/.wave/plugins/`, `settings.json`)
**Testing**: Vitest, HookTester
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (pnpm)
**Performance Goals**: Responsive UI (<100ms for navigation), clear feedback for IO operations.
**Constraints**: Must run within the existing terminal-based chat interface.
**Scale/Scope**: ~5-10 interactive screens/views.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic in `agent-sdk`, UI in `code`.
- [x] **TypeScript Excellence**: Strict typing for all new components and interfaces.
- [x] **Test Alignment**: Unit tests for UI components and integration tests for service interactions.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Documentation Minimalism**: No extra docs beyond spec/plan/research.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Source Code Structure**: Follows established patterns for `code` and `agent-sdk`.
- [x] **Data Model Minimalism**: Concise `Plugin` and `Marketplace` entities.
- [x] **Planning with General-Purpose Agent**: All planning phases performed using general-purpose agent.

**REQUIRED**: All planning phases (Research, Design, Task Breakdown) MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning.

## Project Structure

### Documentation (this feature)

```
specs/060-plugin-interactive-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── api-contracts.md     # Phase 1 output
└── tasks.md             # Phase 2 output (to be created)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── services/
│       │   ├── MarketplaceService.ts (existing, may need minor updates)
│       │   └── configurationService.ts (existing)
│       └── types.ts (existing, update with new plugin types)
└── code/
    └── src/
        ├── components/
        │   ├── PluginManagerUI.tsx (NEW)
        │   └── CommandSelector.tsx (existing, update to register /plugin)
        ├── hooks/
        │   └── useInputManager.ts (existing, update for showPluginManager)
        └── managers/
            └── InputManager.ts (existing, update for showPluginManager)
```

**Structure Decision**: Monorepo structure with clear separation between SDK (logic) and Code (UI).

## Complexity Tracking

*No violations identified.*
