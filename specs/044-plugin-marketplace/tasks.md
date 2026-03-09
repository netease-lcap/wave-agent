# Tasks: Plugin Marketplace and Management UI

This document combines the tasks for the plugin marketplace and management UI.

## Phase 1: Setup (Shared Infrastructure)
- [x] T001 Define marketplace and registry types in `packages/agent-sdk/src/types/marketplace.ts`
- [x] T002 Create `MarketplaceService` skeleton in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T003 Initialize `~/.wave/plugins` directory structure in `MarketplaceService`
- [x] T004 Create directory structure for PluginManager components in `packages/code/src/components/` (Verified: `PluginDetail.tsx`, `PluginList.tsx`, `PluginManagerShell.tsx`, `PluginManagerTypes.ts`)
- [x] T005 Create types for UI state in `packages/code/src/components/PluginManagerTypes.ts` (Verified)

## Phase 2: Foundational (Blocking Prerequisites)
- [x] T006 Implement `KnownMarketplacesRegistry` and `InstalledPluginsRegistry` IO in `MarketplaceService`
- [x] T007 Implement marketplace manifest (`marketplace.json`) loading and validation in `MarketplaceService`
- [x] T008 Implement `GitService` in `packages/agent-sdk/src/services/GitService.ts` to handle `git clone` and `git pull` operations
- [x] T009 Implement `usePluginManager` hook in `packages/code/src/hooks/usePluginManager.ts` (Verified)
- [x] T010 Create `PluginManagerShell` component in `packages/code/src/components/PluginManagerShell.tsx` (Verified)

## Phase 3: User Story 1 - Discover and Install Plugins (Priority: P1)
- [x] T011 Implement `addMarketplace` logic for local, GitHub, and Git repositories in `MarketplaceService`
- [x] T012 Implement `listMarketplaces` logic in `MarketplaceService`
- [x] T013 Modify `getKnownMarketplaces` to return builtin if config file is missing in `MarketplaceService`
- [x] T014 Implement atomic plugin copy logic (tmp -> cache) in `MarketplaceService`
- [x] T015 Implement `installPlugin` logic in `MarketplaceService` with scope support
- [x] T016 Implement `DiscoverView` component in `packages/code/src/components/PluginManager/views/DiscoverView.tsx`
- [x] T017 Implement `PluginDetail` component in `packages/code/src/components/PluginManager/views/PluginDetail.tsx`
- [x] T018 Update `PluginManager` to load plugins from `installed_plugins.json` in `packages/agent-sdk/src/managers/PluginManager.ts`

## Phase 4: User Story 2 - Manage Installed Plugins (Priority: P2)
- [x] T019 Implement `InstalledView` component in `packages/code/src/components/PluginManager/views/InstalledView.tsx`
- [x] T020 Integrate `PluginScopeManager.enablePlugin/disablePlugin/uninstallPlugin` in `usePluginManager` hook
- [x] T021 Implement plugin update logic (re-install) in `MarketplaceService`

## Phase 5: User Story 3 - Manage Marketplaces (Priority: P3)
- [x] T022 Implement `MarketplaceView` component in `packages/code/src/components/PluginManager/views/MarketplaceView.tsx`
- [x] T023 Implement `MarketplaceAddForm` component in `packages/code/src/components/PluginManager/views/MarketplaceAddForm.tsx`
- [x] T024 Implement `updateMarketplace` and `updateAllMarketplaces` logic in `MarketplaceService`
- [x] T025 Implement `removeMarketplace` logic in `MarketplaceService`

## Phase 6: Polish & Cross-Cutting Concerns
- [x] T026 Add loading indicators and error boundaries to all views
- [x] T027 Implement keyboard shortcuts (Tab for navigation, Esc for back)
- [x] T028 Implement auto-update support for marketplaces
- [x] T029 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [x] T030 Verify full end-to-end flow using the `quickstart.md` scenarios
