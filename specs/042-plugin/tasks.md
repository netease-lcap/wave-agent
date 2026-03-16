# Tasks: Plugin Support

This document combines the tasks for the plugin support system.

## Phase 1: Setup (Shared Infrastructure)
- [x] T001 Define `Plugin`, `PluginManifest`, and `PluginConfig` types in `packages/agent-sdk/src/types/index.ts`
- [x] T002 Update `AgentOptions` in `packages/agent-sdk/src/agent.ts` to include `plugins` array
- [x] T003 Update `WaveConfiguration` type in `packages/agent-sdk/src/types/hooks.ts` to include `enabledPlugins: Record<string, boolean>`

## Phase 2: Foundational (Blocking Prerequisites)
- [x] T004 Implement `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts` to read and validate `.wave-plugin/plugin.json`
- [x] T005 Implement `PluginManager` in `packages/agent-sdk/src/managers/pluginManager.ts` to store and manage loaded plugins
- [x] T006 Implement `updateEnabledPlugin` and `getMergedEnabledPlugins` in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T007 Implement `PluginScopeManager` in `packages/agent-sdk/src/managers/pluginScopeManager.ts`
- [x] T008 Implement `GitService` in `packages/agent-sdk/src/services/GitService.ts` to handle `git clone` and `git pull` operations

## Phase 3: User Story 1 - Developer creates a local plugin (Priority: P1)
- [x] T009 Update `PluginLoader` to load commands from `commands/*.md`
- [x] T010 Update `SlashCommandManager` to accept commands from plugins with namespacing
- [x] T011 Implement `loadSkills` static method in `PluginLoader` to parse `SKILL.md` files
- [x] T012 Implement `registerPluginSkills` in `SkillManager`
- [x] T013 Implement `loadLspConfig`, `loadMcpConfig`, and `loadHooksConfig` in `PluginLoader`
- [x] T014 Implement `registerPluginHooks` in `HookManager`
- [x] T015 Update `PluginManager.loadPlugins` to orchestrate loading and registration of all component types
- [x] T016 Implement validation in `PluginLoader` to ensure no component directories are inside `.wave-plugin/`

## Phase 4: User Story 2 - User loads and manages plugins (Priority: P1)
- [x] T017 Add `--plugin-dir` option to `yargs` configuration in `packages/code/src/index.ts`
- [x] T018 Create `enable.ts` and `disable.ts` commands in `packages/code/src/commands/plugin/`
- [x] T019 Update `install.ts` command to support scoped installation and auto-enable
- [x] T020 Update `PluginManager` to filter loaded plugins by `enabledPlugins` across all scopes

## Phase 5: Polish & Cross-Cutting Concerns
- [x] T021 Modify `Skill` and `Task` tools to use getters for their `config` property for dynamic tool definitions
- [x] T022 Run `pnpm build` and verify the full flow using `quickstart.md`
- [x] T023 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [x] T024 Ensure all "Claude" references in new code/logs are replaced with "Agent"
