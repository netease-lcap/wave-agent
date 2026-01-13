# Tasks: Local Plugin Marketplace

**Feature Branch**: `044-local-plugin-marketplace`
**Implementation Plan**: `specs/044-local-plugin-marketplace/plan.md`
**Feature Specification**: `specs/044-local-plugin-marketplace/spec.md`

## Implementation Strategy

We will follow an incremental delivery approach, focusing on the core marketplace registration first (US1), followed by the plugin installation logic (US2). We will leverage the existing `PluginManager` in `agent-sdk` and extend it to support marketplace-based discovery and loading.

1.  **Phase 1 & 2**: Setup the data structures and core services in `agent-sdk`.
2.  **Phase 3 (US1)**: Implement marketplace registration and listing.
3.  **Phase 4 (US2)**: Implement plugin installation with atomic copy-then-rename logic.
4.  **Phase 5**: Polish and integration.

## Phase 1: Setup

- [X] T001 Define marketplace and registry types in `packages/agent-sdk/src/types.ts`
- [X] T002 Create `MarketplaceService` skeleton in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T003 Initialize `~/.wave/plugins` directory structure in `MarketplaceService`

## Phase 2: Foundational

- [X] T004 Implement `KnownMarketplacesRegistry` IO in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T005 Implement `InstalledPluginsRegistry` IO in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T006 Implement marketplace manifest (`marketplace.json`) loading and validation in `packages/agent-sdk/src/services/MarketplaceService.ts`

## Phase 3: User Story 1 - Create and Add Local Marketplace (Priority: P1)

**Goal**: Allow users to register a local directory as a marketplace.
**Independent Test**: Run `wave plugin marketplace add [path]` and verify it appears in `known_marketplaces.json`.

- [X] T007 [P] [US1] Implement `addMarketplace` logic in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T008 [P] [US1] Implement `listMarketplaces` logic in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T009 [US1] Create `wave plugin marketplace add` command in `packages/code/src/commands/plugin/marketplace.ts`
- [X] T010 [US1] Create `wave plugin marketplace list` command in `packages/code/src/commands/plugin/marketplace.ts`
- [X] T011 [US1] Add unit tests for marketplace registration in `packages/agent-sdk/tests/services/MarketplaceService.test.ts`

## Phase 4: User Story 2 - Install Plugin from Local Marketplace (Priority: P1)

**Goal**: Install a plugin from a registered marketplace into the local cache.
**Independent Test**: Run `wave plugin install [plugin]@[marketplace]` and verify files exist in `~/.wave/plugins/cache/`.

- [X] T012 [P] [US2] Implement atomic plugin copy logic (tmp -> cache) in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T013 [P] [US2] Implement `installPlugin` logic in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T014 [US2] Create `wave plugin install` command in `packages/code/src/commands/plugin/install.ts`
- [X] T015 [US2] Update `PluginManager` to load plugins from `installed_plugins.json` in `packages/agent-sdk/src/managers/PluginManager.ts`
- [X] T016 [US2] Implement plugin update logic (re-install) in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [X] T017 [US2] Add unit tests for plugin installation in `packages/agent-sdk/tests/services/MarketplaceService.install.test.ts`

## Phase 5: Polish & Cross-cutting Concerns

- [X] T018 Implement error handling for invalid marketplace paths and missing manifests
- [X] T019 Ensure proper command prefixing for installed plugins in `packages/agent-sdk/src/managers/PluginManager.ts`
- [X] T020 Run `pnpm run type-check` and `pnpm lint` across the workspace
- [X] T021 Verify full end-to-end flow using the `quickstart.md` scenarios

## Dependencies

- US1 (Marketplace registration) is a prerequisite for US2 (Plugin installation).
- Phase 1 & 2 must be completed before any User Story tasks.

## Parallel Execution Examples

- **US1**: T007 and T008 can be developed in parallel as they handle different registry operations.
- **US2**: T012 and T013 can be developed in parallel once the basic `MarketplaceService` structure is ready.
