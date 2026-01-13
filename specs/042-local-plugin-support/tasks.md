# Tasks: Local Plugin Support

**Input**: Design documents from `/specs/042-local-plugin-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included as requested by the quality standards in the constitution (Test Alignment).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Define `Plugin`, `PluginManifest`, and `PluginConfig` types in `packages/agent-sdk/src/types/index.ts`
- [x] T002 Update `AgentOptions` in `packages/agent-sdk/src/agent.ts` to include `plugins` array

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts` to read and validate `.wave-plugin/plugin.json`
- [x] T004 Implement `PluginManager` in `packages/agent-sdk/src/managers/pluginManager.ts` to store and manage loaded plugins

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Developer creates a local plugin (Priority: P1) 🎯 MVP

**Goal**: Enable the system to recognize and load a plugin structure from the filesystem.

**Independent Test**: Create a directory with `.wave-plugin/plugin.json` and verify `PluginLoader` correctly parses it.

### Implementation for User Story 1

- [x] T005 [US1] Update `PluginLoader` in `packages/agent-sdk/src/services/pluginLoader.ts` to load commands from `commands/*.md`
- [x] T006 [US1] Update `SlashCommandManager` in `packages/agent-sdk/src/managers/slashCommandManager.ts` to accept commands from plugins with namespacing
- [x] T007 [US1] Initialize `PluginManager` in `Agent` constructor in `packages/agent-sdk/src/agent.ts` and load plugins from `AgentOptions`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - User loads a local plugin via CLI (Priority: P1)

**Goal**: Allow users to specify plugin directories when starting the CLI.

**Independent Test**: Run `wave --plugin-dir ./my-plugin` and verify the plugin is loaded into the agent.

### Implementation for User Story 2

- [x] T008 [US2] Add `--plugin-dir` option to `yargs` configuration in `packages/code/src/index.ts`
- [x] T009 [US2] Update `CliOptions` and `startCli` in `packages/code/src/cli.tsx` to handle `pluginDirs`
- [x] T010 [US2] Update `App` component in `packages/code/src/components/App.tsx` to accept `pluginDirs` prop
- [x] T011 [US2] Update `useChat` context in `packages/code/src/contexts/useChat.tsx` to pass `pluginDirs` to `Agent.create`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - User executes a plugin command (Priority: P1)

**Goal**: Enable execution of namespaced slash commands from loaded plugins.

**Independent Test**: Type `/my-plugin:hello` in the CLI and verify the agent responds with the plugin's command content.

### Implementation for User Story 3

- [x] T012 [US3] Update `SlashCommandManager.parseAndValidateSlashCommand` in `packages/agent-sdk/src/managers/slashCommandManager.ts` to handle namespaced commands
- [x] T013 [US3] Update `SlashCommandManager.executeCommand` in `packages/agent-sdk/src/managers/slashCommandManager.ts` to execute plugin commands

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T014 [P] Add unit tests for `PluginLoader` in `packages/agent-sdk/tests/services/pluginLoader.test.ts`
- [x] T015 [P] Add unit tests for `PluginManager` in `packages/agent-sdk/tests/managers/pluginManager.test.ts`
- [x] T016 [P] Add integration tests for plugin loading and execution in `packages/agent-sdk/tests/agent.plugin.test.ts`
- [x] T017 Run `pnpm build` and verify the full flow using `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1) is the MVP and should be completed first.
  - User Story 2 and 3 depend on the core loading logic from US1.
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P2)**: Depends on US1 for the underlying plugin loading logic
- **User Story 3 (P3)**: Depends on US1 and US2 for loading and namespacing

### Parallel Opportunities

- T014, T015, T016 can run in parallel.
- Once Phase 2 is done, US1 implementation can proceed.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently by manually adding a plugin to `AgentOptions` in a test script.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test CLI integration
4. Add User Story 3 → Test command execution
