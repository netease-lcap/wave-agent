# Tasks: Expand Plugin Capabilities

## Phase 1: Setup
Goal: Initialize the development environment and prepare for implementation.

- [X] T001 Create feature branch `043-expand-plugin-capabilities`
- [X] T002 [P] Verify existing plugin tests pass in `packages/agent-sdk/tests/services/pluginLoader.test.ts`

## Phase 2: Foundational
Goal: Define the core types and interfaces that will be used across all user stories.

- [X] T003 Update `PluginManifest` interface in `packages/agent-sdk/src/types/plugins.ts` to include optional fields for new capabilities
- [X] T004 [P] Define `Plugin` entity structure in `packages/agent-sdk/src/types/plugins.ts` as per `data-model.md`
- [X] T005 [P] Add `registerPluginSkills` method signature to `SkillManager` in `packages/agent-sdk/src/managers/skillManager.ts`
- [X] T006 [P] Add `registerPluginHooks` method signature to `HookManager` in `packages/agent-sdk/src/managers/hookManager.ts`

## Phase 3: User Story 1 - Adding Skills to a Plugin (P1)
Goal: Enable plugins to provide Agent Skills via a `skills/` directory.

- [X] T007 [US1] Implement `loadSkills` static method in `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts`
- [X] T008 [US1] Update `PluginLoader.loadSkills` to use `skillParser.ts` for parsing `SKILL.md` files
- [X] T009 [US1] Implement `registerPluginSkills` in `SkillManager` in `packages/agent-sdk/src/managers/skillManager.ts`
- [X] T010 [US1] Update `PluginManager.loadPlugins` in `packages/agent-sdk/src/managers/pluginManager.ts` to call `PluginLoader.loadSkills` and register them
- [X] T011 [US1] Add unit tests for skill loading in `packages/agent-sdk/tests/services/pluginLoader.test.ts`
- [X] T012 [US1] Add integration test for skill registration in `packages/agent-sdk/tests/managers/pluginManager.test.ts`

## Phase 4: User Story 2 - Adding LSP Servers to a Plugin (P2)
Goal: Enable plugins to provide LSP server configurations via `.lsp.json`.

- [X] T013 [US2] Implement `loadLspConfig` static method in `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts`
- [X] T014 [US2] Update `PluginManager.loadPlugins` in `packages/agent-sdk/src/managers/pluginManager.ts` to call `PluginLoader.loadLspConfig` and register with `LspManager`
- [X] T015 [US2] Add unit tests for LSP config loading in `packages/agent-sdk/tests/services/pluginLoader.test.ts`
- [X] T016 [US2] Add integration test for LSP registration in `packages/agent-sdk/tests/managers/pluginManager.test.ts`

## Phase 5: User Story 3 - Correct Plugin Structure Validation (P3)
Goal: Prevent common mistakes by validating the plugin directory structure.

- [X] T017 [US3] Implement validation in `PluginLoader.loadManifest` to ensure no component directories are inside `.wave-plugin/`
- [X] T018 [US3] Add validation to `PluginLoader` to ensure `plugin.json` is the only file in `.wave-plugin/`
- [X] T019 [US3] Add unit tests for structure validation in `packages/agent-sdk/tests/services/pluginLoader.test.ts`

## Phase 6: Additional Capabilities (MCP & Hooks)
Goal: Implement support for MCP servers and Hooks as defined in the research and contracts.

- [X] T020 [P] Implement `loadMcpConfig` static method in `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts`
- [X] T021 [P] Implement `loadHooksConfig` static method in `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts`
- [X] T022 Implement `registerPluginHooks` in `HookManager` in `packages/agent-sdk/src/managers/hookManager.ts`
- [X] T023 Update `PluginManager.loadPlugins` to orchestrate loading and registration of MCP and Hooks
- [X] T024 Add unit tests for MCP and Hooks loading in `packages/agent-sdk/tests/services/pluginLoader.test.ts`

## Phase 7: Polish & Cross-Cutting Concerns
Goal: Final verification, documentation, and cleanup.

- [X] T025 Create an example complex plugin in `packages/agent-sdk/examples/complex-plugin` following `quickstart.md`
- [X] T026 [P] Verify all plugin components load correctly using the example plugin
- [X] T027 [P] Run `pnpm test`, `pnpm run type-check`, and `pnpm lint` across the workspace
- [X] T028 [P] Ensure all "Claude" references in new code/logs are replaced with "Agent"

## Phase 8: Dynamic Tool Definitions
Goal: Ensure that tools like `Skill` and `Task` dynamically reflect the current set of available components (skills, subagents) even if they are added after the tool is initialized.

- [X] T029 [P] Modify `Skill` tool to use a getter for its `config` property to dynamically reflect available skills.
- [X] T030 [P] Modify `Task` tool to use a getter for its `config` property to dynamically reflect available subagents.
- [X] T031 [P] Add unit tests to verify dynamic tool definitions.

## Dependencies
- Phase 2 must be completed before Phase 3, 4, 5, and 6.
- Phase 3, 4, 5, and 6 can be implemented in parallel after Phase 2 is complete.
- Phase 7 must be completed after all other phases.

## Parallel Execution Examples
- **User Story 1 (Skills)**: T007, T008, and T009 can be worked on simultaneously if interfaces are stable.
- **User Story 2 (LSP)**: T013 and T014 can be worked on in parallel with User Story 1 tasks.
- **Additional Capabilities**: T020 and T021 are independent and can be done in parallel.

## Implementation Strategy
- **MVP First**: Focus on completing Phase 2 and Phase 3 (User Story 1) to deliver the most critical capability (Skills) first.
- **Incremental Delivery**: Each User Story phase results in a complete, testable increment of the plugin system.
- **Test-Driven**: Unit tests in `PluginLoader` should be written alongside or before implementation to ensure discovery rules are strictly followed.
