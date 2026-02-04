# Tasks: Plugin Management UI

**Input**: Design documents from `/specs/060-plugin-management-ui/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create directory structure for PluginManager components in packages/code/src/components/PluginManager/
- [x] T002 [P] Create types for UI state in packages/code/src/components/PluginManager/types.ts
- [x] T003 [P] Export startPluginManagerCli from packages/code/src/plugin-manager-cli.tsx

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement usePluginManager hook in packages/code/src/components/PluginManager/hooks/usePluginManager.ts to wrap agent-sdk services
- [x] T005 Create PluginManagerShell component in packages/code/src/components/PluginManager/PluginManagerShell.tsx for main layout and navigation
- [x] T006 [P] Implement generic PluginList component in packages/code/src/components/PluginManager/components/PluginList.tsx
- [x] T007 [P] Implement generic MarketplaceList component in packages/code/src/components/PluginManager/components/MarketplaceList.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Discover and Install Plugins (Priority: P1) 🎯 MVP

**Goal**: Browse available plugins from marketplaces and install them in User, Project, or Local scopes.

**Independent Test**: Run `wave plugin`, navigate to "Discover", select a plugin, and choose an installation scope. Verify plugin is installed in the correct scope.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T008 [P] [US1] Unit test for Discover view in packages/code/tests/components/PluginManager/DiscoverView.test.tsx
- [x] T009 [US1] Integration test for plugin installation flow in packages/code/tests/integration/plugin-install.test.ts

### Implementation for User Story 1

- [x] T010 [US1] Implement DiscoverView component in packages/code/src/components/PluginManager/views/DiscoverView.tsx
- [x] T011 [US1] Implement PluginDetail component in packages/code/src/components/PluginManager/views/PluginDetail.tsx with installation scope selection
- [x] T012 [US1] Integrate MarketplaceService.getPluginsFromMarketplace in usePluginManager hook
- [x] T013 [US1] Integrate MarketplaceService.installPlugin in usePluginManager hook

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Manage Installed Plugins (Priority: P2)

**Goal**: View installed plugins and toggle their status (Enable/Disable) or Uninstall them.

**Independent Test**: Navigate to "Installed", select a plugin, and perform enable/disable/uninstall actions. Verify changes in settings.json.

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] T014 [P] [US2] Unit test for InstalledView in packages/code/tests/components/PluginManager/InstalledView.test.tsx
- [x] T015 [US2] Integration test for plugin management (toggle/uninstall) in packages/code/tests/integration/plugin-management.test.ts

### Implementation for User Story 2

- [x] T016 [US2] Implement InstalledView component in packages/code/src/components/PluginManager/views/InstalledView.tsx
- [x] T017 [US2] Integrate PluginScopeManager.getInstalledPlugins in usePluginManager hook
- [x] T018 [US2] Integrate PluginScopeManager.enablePlugin/disablePlugin in usePluginManager hook
- [x] T019 [US2] Integrate PluginScopeManager.uninstallPlugin in usePluginManager hook

**Checkpoint**: User Stories 1 and 2 are functional.

---

## Phase 5: User Story 3 - Manage Marketplaces (Priority: P3)

**Goal**: Add, update, and remove marketplace sources (GitHub, SSH, Local).

**Independent Test**: Navigate to "Marketplaces", add a new source, update it, and then remove it. Verify known_marketplaces.json updates.

### Tests for User Story 3 (REQUIRED) ⚠️

- [x] T020 [P] [US3] Unit test for MarketplaceView in packages/code/tests/components/PluginManager/MarketplaceView.test.tsx
- [x] T021 [US3] Integration test for marketplace management in packages/code/tests/integration/marketplace-management.test.ts

### Implementation for User Story 3

- [x] T022 [US3] Implement MarketplaceView component in packages/code/src/components/PluginManager/views/MarketplaceView.tsx
- [x] T023 [US3] Implement MarketplaceAddForm component in packages/code/src/components/PluginManager/views/MarketplaceAddForm.tsx
- [x] T024 [US3] Integrate MarketplaceService.addMarketplace in usePluginManager hook
- [x] T025 [US3] Integrate MarketplaceService.removeMarketplace in usePluginManager hook
- [x] T026 [US3] Integrate MarketplaceService.updateMarketplace in usePluginManager hook

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T027 [P] Add loading indicators and error boundaries to all views
- [x] T028 [P] Implement keyboard shortcuts (Tab for navigation, Esc for back)
- [x] T029 [P] Add functional example in packages/code/examples/plugin-manager.ts
- [x] T030 Final type-check and linting across all new files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all user stories.

### User Story Dependencies

- **User Story 1 (P1)**: MVP - No dependencies on other stories.
- **User Story 2 (P2)**: Independent but shares foundational components.
- **User Story 3 (P3)**: Independent but shares foundational components.

### Parallel Opportunities

- T002, T003 (Setup)
- T006, T007 (Foundational)
- T008, T014, T020 (Unit tests across stories)
- T027, T028, T029 (Polish)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently.

### Incremental Delivery

1. Foundation ready.
2. Add User Story 1 (MVP).
3. Add User Story 2.
4. Add User Story 3.
5. Polish.
