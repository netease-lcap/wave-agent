# Tasks: Plugin Scope Management

**Feature Branch**: `045-plugin-scope-management`
**Implementation Plan**: `specs/045-plugin-scope-management/plan.md`
**Feature Specification**: `specs/045-plugin-scope-management/spec.md`

## Implementation Strategy

We will follow an incremental delivery approach, starting with the core configuration logic in `agent-sdk` (Phase 1 & 2), followed by the CLI commands for enabling/disabling plugins (US1), and finally updating the installation logic (US2). We will ensure that the priority system (`local` > `project` > `user`) is correctly implemented in the `ConfigurationService`.

1.  **Phase 1 & 2**: Update types and implement core logic in `agent-sdk`.
2.  **Phase 3 (US1)**: Implement `enable` and `disable` CLI commands.
3.  **Phase 4 (US2)**: Update `install` command to support scoped installation and auto-enable.
4.  **Phase 5**: Polish and validation.

## Phase 1: Setup

- [X] T001 Update `WaveConfiguration` type in `packages/agent-sdk/src/types/hooks.ts` to include `enabledPlugins: Record<string, boolean>`

## Phase 2: Foundational

- [X] T002 Implement `updateEnabledPlugin` in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T003 Implement `getMergedEnabledPlugins` in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T004 Update `PluginManager` constructor and `loadInstalledPlugins` in `packages/agent-sdk/src/managers/pluginManager.ts` to filter by `enabledPlugins`
- [X] T005 Implement `PluginScopeManager` in `packages/agent-sdk/src/managers/pluginScopeManager.ts`
- [X] T006 Add unit tests for `ConfigurationService` enabled plugins logic in `packages/agent-sdk/tests/services/configurationService.test.ts`
- [X] T007 Add unit tests for `PluginManager` filtering logic in `packages/agent-sdk/tests/managers/pluginManager.test.ts`

## Phase 3: User Story 1 - Contextual Plugin Control (Priority: P1)

**Goal**: Enable/disable plugins via CLI and respect scope priority.
**Independent Test**: Run `wave plugin disable <plugin> -s project` and verify it's disabled in the project but enabled globally.

- [X] T008 [P] [US1] Create `packages/code/src/commands/plugin/enable.ts` for the `enable` command
- [X] T009 [P] [US1] Create `packages/code/src/commands/plugin/disable.ts` for the `disable` command
- [X] T010 [US1] Refactor `wave plugin` command in `packages/code/src/index.ts` to use external command handlers and add `enable`/`disable`
- [X] T011 [US1] Add integration tests for enable/disable commands in `packages/code/tests/commands/plugin/scope.test.ts`

## Phase 4: User Story 2 - Scoped Plugin Installation (Priority: P1)

**Goal**: Support `--scope` in `wave plugin install` and auto-enable.
**Independent Test**: Run `wave plugin install <plugin>@<marketplace> -s project` and verify it's added to `.wave/settings.json`.

- [X] T012 [US2] Create `packages/code/src/commands/plugin/install.ts` with `--scope` support and auto-enable logic
- [X] T013 [US2] Update `packages/code/src/index.ts` to use the new `install` command handler
- [X] T014 [US2] Add integration tests for scoped installation in `packages/code/tests/commands/plugin/install.scope.test.ts`

## Phase 5: Polish & Cross-cutting Concerns

- [X] T015 Implement error handling for invalid scopes and missing `.wave` directories in `ConfigurationService`
- [X] T016 Run `pnpm build` in `agent-sdk` and verify CLI integration
- [X] T017 Run `pnpm run type-check` and `pnpm lint` across the workspace
- [X] T018 Update default scope to `user` for `enable`, `disable`, and `install` commands in `packages/code/src/index.ts` and update `spec.md`

## Dependencies

- Phase 2 (Foundational) must be completed before Phase 3 and 4.
- US1 (Enable/Disable) and US2 (Scoped Install) are largely independent but both depend on Phase 2.

## Parallel Execution Examples

- **Phase 3**: T008 and T009 can be developed in parallel.
- **Phase 2**: T006 and T007 can be developed in parallel once the implementation is ready.
