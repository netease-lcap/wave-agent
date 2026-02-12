# Tasks: Custom Slash Commands

**Input**: Design documents from `./specs/008-slash-commands-spec/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

## Phase 1: Core Implementation (Completed)

- [X] T001 Implement `SlashCommandManager` for command registration and lookup
- [X] T002 Implement file-based command discovery in `.wave/commands/`
- [X] T003 Implement parameter substitution for `$ARGUMENTS`, `$1`, `$2`, etc.
- [X] T004 Implement YAML frontmatter parsing for command configuration
- [X] T005 Implement embedded bash command execution
- [X] T006 Implement `CommandSelector` UI component with search filtering
- [X] T007 Integrate slash commands into the main chat interface

## Phase 2: Allowed Tools Support (Merged from 048)

- [X] T008 Update `CustomSlashCommandConfig` interface to include `allowedTools?: string[]` in `packages/agent-sdk/src/types/commands.ts`
- [X] T009 Update `parseFrontmatter` to support array parsing for `allowed-tools` in `packages/agent-sdk/src/utils/markdownParser.ts`
- [X] T010 Update `parseMarkdownFile` to map `allowed-tools` from frontmatter to `config.allowedTools` in `packages/agent-sdk/src/utils/markdownParser.ts`
- [X] T011 Add `temporaryRules` private property and `addTemporaryRules`/`clearTemporaryRules` public methods to `PermissionManager` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T012 Update `isAllowedByRule` in `PermissionManager` to check both `allowedRules` and `temporaryRules` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T013 Update `AIManagerOptions` to include `permissionManager: PermissionManager` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T014 Update `Agent` constructor to pass `permissionManager` to `AIManager` in `packages/agent-sdk/src/agent.ts`
- [X] T015 Update `sendAIMessage` in `AIManager` to accept `allowedTools?: string[]` in options in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T016 Implement logic in `sendAIMessage` to call `permissionManager.addTemporaryRules` when `recursionDepth === 0` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T017 Update `executeCustomCommandInMainAgent` in `SlashCommandManager` to pass `config.allowedTools` to `aiManager.sendAIMessage` in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [X] T018 Implement `finally` block logic in `sendAIMessage` to call `permissionManager.clearTemporaryRules` when `recursionDepth === 0` in `packages/agent-sdk/src/managers/aiManager.ts`

## Phase 3: Nested Command Discovery (Merged from 018)

- [X] T019 Create enhanced type definitions in `packages/agent-sdk/src/types/commands.ts` (add nested command fields)
- [X] T020 Create utility functions for path-to-command-ID conversion in `packages/agent-sdk/src/utils/commandPathResolver.ts`
- [X] T021 Add command ID validation utilities in `packages/agent-sdk/src/utils/commandPathResolver.ts`
- [X] T022 Implement recursive directory scanning with depth control in `packages/agent-sdk/src/utils/customCommands.ts`
- [X] T023 Implement command ID generation from file paths in `packages/agent-sdk/src/utils/commandPathResolver.ts`
- [X] T024 Update `scanCommandsDirectory` function to use recursive scanning in `packages/agent-sdk/src/utils/customCommands.ts`
- [X] T025 Add nested command metadata to returned `CustomSlashCommand` objects in `packages/agent-sdk/src/utils/customCommands.ts`
- [X] T026 Add error handling for deep nesting and invalid file names in `packages/agent-sdk/src/utils/customCommands.ts`
- [X] T027 Update command input parsing to handle colon syntax in `packages/agent-sdk/src/managers/slashCommandManager.ts`

## Phase 4: Plugin Environment Variables

- [X] T028 Add `pluginPath?: string` field to `CustomSlashCommand` interface in `packages/agent-sdk/src/types/commands.ts`
- [X] T029 Update `PluginLoader.loadCommands` to return commands with plugin path metadata in `packages/agent-sdk/src/services/pluginLoader.ts`
- [X] T030 Update `PluginManager.loadSinglePlugin` to pass plugin path when registering plugin commands in `packages/agent-sdk/src/managers/pluginManager.ts`
- [X] T031 Update `SlashCommandManager.registerPluginCommands` to accept and store plugin path for each command in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [X] T032 Update `SlashCommandManager.executeCustomCommandInMainAgent` to set `WAVE_PLUGIN_ROOT` environment variable when executing bash commands for plugin commands in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [X] T033 Add tests for plugin commands with WAVE_PLUGIN_ROOT environment variable in `packages/agent-sdk/tests/managers/slashCommandManager.test.ts`

