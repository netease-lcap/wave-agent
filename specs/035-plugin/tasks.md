# Tasks: Plugin Support and Marketplace

This document combines the tasks for the plugin support system and the plugin marketplace.

## Phase 1: Setup (Shared Infrastructure)
- [x] T001 Define `Plugin`, `PluginManifest`, and `PluginConfig` types in `packages/agent-sdk/src/types/index.ts`
- [x] T002 Update `AgentOptions` in `packages/agent-sdk/src/agent.ts` to include `plugins` array
- [x] T003 Update `WaveConfiguration` type in `packages/agent-sdk/src/types/hooks.ts` to include `enabledPlugins: Record<string, boolean>`
- [x] T025 Define marketplace and registry types in `packages/agent-sdk/src/types/marketplace.ts`
- [x] T026 Create `MarketplaceService` skeleton in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T027 Initialize `~/.wave/plugins` directory structure in `MarketplaceService`
- [x] T028 Create directory structure for PluginManager components in `packages/code/src/components/` (Verified: `PluginDetail.tsx`, `PluginList.tsx`, `PluginManagerShell.tsx`, `PluginManagerTypes.ts`)
- [x] T029 Create types for UI state in `packages/code/src/components/PluginManagerTypes.ts` (Verified)

## Phase 2: Foundational (Blocking Prerequisites)
- [x] T004 Implement `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts` to read and validate `.wave-plugin/plugin.json`
- [x] T005 Implement `PluginManager` in `packages/agent-sdk/src/managers/pluginManager.ts` to store and manage loaded plugins
- [x] T006 Implement `updateEnabledPlugin` and `getMergedEnabledPlugins` in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T007 Implement `PluginScopeManager` in `packages/agent-sdk/src/managers/pluginScopeManager.ts`
- [x] T008 Implement `GitService` in `packages/agent-sdk/src/services/GitService.ts` to handle `git clone` and `git pull` operations
- [x] T030 Implement `KnownMarketplacesRegistry` and `InstalledPluginsRegistry` IO in `MarketplaceService`
- [x] T031 Implement marketplace manifest (`marketplace.json`) loading and validation in `MarketplaceService`
- [x] T032 Implement `GitService` in `packages/agent-sdk/src/services/GitService.ts` to handle `git clone` and `git pull` operations (Duplicate of T008)
- [x] T033 Implement `usePluginManager` hook in `packages/code/src/hooks/usePluginManager.ts` (Verified)
- [x] T034 Create `PluginManagerShell` component in `packages/code/src/components/PluginManagerShell.tsx` (Verified)

## Phase 3: Local Plugin Support (Story 1)
- [x] T009 Update `PluginLoader` to load commands from `commands/*.md`
- [x] T010 Update `SlashCommandManager` to accept commands from plugins with namespacing
- [x] T011 Implement `loadSkills` static method in `PluginLoader` to parse `SKILL.md` files
- [x] T012 Implement `registerPluginSkills` in `SkillManager`
- [x] T013 Implement `loadLspConfig`, `loadMcpConfig`, and `loadHooksConfig` in `PluginLoader`
- [x] T014 Implement `registerPluginHooks` in `HookManager`
- [x] T015 Update `PluginManager.loadPlugins` to orchestrate loading and registration of all component types
- [x] T016 Implement validation in `PluginLoader` to ensure no component directories are inside `.wave-plugin/`

## Phase 4: User Loads and Manages Plugins (Story 2)
- [x] T017 Add `--plugin-dir` option to `yargs` configuration in `packages/code/src/index.ts`
- [x] T018 Create `enable.ts` and `disable.ts` commands in `packages/code/src/commands/plugin/`
- [x] T019 Update `install.ts` command to support scoped installation and auto-enable
- [x] T020 Update `PluginManager` to filter loaded plugins by `enabledPlugins` across all scopes

## Phase 5: Discover and Install Plugins (Story 4)
- [x] T035 Implement `addMarketplace` logic for local, GitHub, and Git repositories in `MarketplaceService`
- [x] T036 Implement `listMarketplaces` logic in `MarketplaceService`
- [x] T037 Modify `getKnownMarketplaces` to return builtin if config file is missing in `MarketplaceService`
- [x] T038 Implement atomic plugin copy logic (tmp -> cache) in `MarketplaceService`
- [x] T039 Implement `installPlugin` logic in `MarketplaceService` with scope support
- [x] T040 Implement `DiscoverView` component in `packages/code/src/components/PluginManager/views/DiscoverView.tsx`
- [x] T041 Implement `PluginDetail` component in `packages/code/src/components/PluginManager/views/PluginDetail.tsx`
- [x] T042 Update `PluginManager` to load plugins from `installed_plugins.json` in `packages/agent-sdk/src/managers/PluginManager.ts`

## Phase 6: Manage Installed Plugins (Story 5)
- [x] T043 Implement `InstalledView` component in `packages/code/src/components/PluginManager/views/InstalledView.tsx`
- [x] T044 Integrate `PluginScopeManager.enablePlugin/disablePlugin/uninstallPlugin` in `usePluginManager` hook
- [x] T045 Implement plugin update logic (re-install) in `MarketplaceService`

## Phase 7: Manage Marketplaces (Story 6)
- [x] T046 Implement `MarketplaceView` component in `packages/code/src/components/PluginManager/views/MarketplaceView.tsx`
- [x] T047 Implement `MarketplaceAddForm` component in `packages/code/src/components/PluginManager/views/MarketplaceAddForm.tsx`
- [x] T048 Implement `updateMarketplace` and `updateAllMarketplaces` logic in `MarketplaceService`
- [x] T049 Implement `removeMarketplace` logic in `MarketplaceService`

## Phase 8: Polish & Cross-Cutting Concerns
- [x] T021 Modify `Skill` and `Task` tools to use getters for their `config` property for dynamic tool definitions
- [x] T022 Run `pnpm build` and verify the full flow using `quickstart.md`
- [x] T023 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [x] T024 Ensure all "Claude" references in new code/logs are replaced with "Agent"
- [x] T050 Add loading indicators and error boundaries to all views
- [x] T051 Implement keyboard shortcuts (Tab for navigation, Esc for back)
- [x] T052 Implement auto-update support for marketplaces
- [x] T053 Run `pnpm run type-check` and `pnpm lint` across the monorepo (Duplicate of T023)
- [x] T054 Verify full end-to-end flow using the `quickstart.md` scenarios (Duplicate of T022)
- [x] T055 Implement "last update" tracking and display for marketplaces
- [x] T056 Implement file-based locking in `MarketplaceService`
- [x] T057 Implement Git operation timeouts in `GitService`
- [x] T058 Implement background auto-update in `PluginManager`
- [x] T059 Implement atomic registry writes in `MarketplaceService`
