# Tasks: Plugin Interactive UI

**Input**: Design documents from `/specs/060-plugin-interactive-ui/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, api-contracts.md

**Tests**: Unit tests and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Define `PluginStatus` and `PluginDetail` types in `packages/agent-sdk/src/types/marketplace.ts`
- [x] T002 [P] Add `checkUpdates` method signature to `MarketplaceService` in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T003 Run `pnpm -F wave-agent-sdk build` to propagate type changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Register `plugin` in `AVAILABLE_COMMANDS` within `packages/code/src/components/CommandSelector.tsx`
- [x] T005 Update `InputManager` state to include `showPluginManager` in `packages/code/src/managers/InputManager.ts`
- [x] T006 Update `useInputManager` hook to expose `showPluginManager` and toggle functions in `packages/code/src/hooks/useInputManager.ts`
- [x] T007 Create skeleton `PluginManagerUI` component in `packages/code/src/components/PluginManagerUI.tsx`
- [x] T008 Integrate `PluginManagerUI` into `InputBox.tsx` rendering logic in `packages/code/src/components/InputBox.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Interactive Plugin Management (Priority: P1) 🎯 MVP

**Goal**: Browse, toggle, and remove installed plugins through an interactive menu.

**Independent Test**: Run `/plugin`, see installed plugins, toggle one, and verify `settings.json` updates.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T009 [P] [US1] Unit test for `PluginManagerUI` rendering installed plugins in `packages/code/tests/components/PluginManagerUI.test.tsx`
- [ ] T010 [US1] Integration test for plugin toggle/remove flow in `packages/code/tests/integration/plugin-management.test.ts`

### Implementation for User Story 1

- [x] T011 [US1] Implement `InstalledPluginsView` sub-component in `packages/code/src/components/PluginManagerUI/InstalledPluginsView.tsx`
- [x] T012 [US1] Implement plugin toggle logic using `ConfigurationService` in `packages/code/src/components/PluginManagerUI/InstalledPluginsView.tsx`
- [x] T013 [US1] Implement plugin removal logic using `MarketplaceService` in `packages/code/src/components/PluginManagerUI/InstalledPluginsView.tsx`
- [x] T014 [US1] Add keyboard navigation (Up/Down/Enter) and Escape to close in `PluginManagerUI.tsx`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Marketplace Browsing and Installation (Priority: P2)

**Goal**: Browse available plugins from marketplaces and install them.

**Independent Test**: Navigate to "Marketplace" in UI, select a new plugin, install it, and verify it appears in "Installed" list.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T015 [P] [US2] Unit test for `MarketplaceView` rendering available plugins in `packages/code/tests/components/MarketplaceView.test.tsx`
- [ ] T016 [US2] Integration test for plugin installation flow in `packages/code/tests/integration/plugin-installation.test.ts`

### Implementation for User Story 2

- [x] T017 [US2] Implement `MarketplaceView` sub-component in `packages/code/src/components/PluginManagerUI/MarketplaceView.tsx`
- [x] T018 [US2] Implement plugin installation logic with progress feedback in `packages/code/src/components/PluginManagerUI/MarketplaceView.tsx`
- [ ] T019 [US2] Implement `PluginDetailView` for showing descriptions and capabilities in `packages/code/src/components/PluginManagerUI/PluginDetailView.tsx`

**Checkpoint**: User Story 2 is fully functional and testable independently.

---

## Phase 5: User Story 3 - Marketplace Management (Priority: P3)

**Goal**: Add and remove registered marketplaces.

**Independent Test**: Navigate to "Manage Marketplaces", add a new URL, and verify it's listed.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T020 [P] [US3] Unit test for `MarketplaceListView` in `packages/code/tests/components/MarketplaceListView.test.tsx`

### Implementation for User Story 3

- [x] T021 [US3] Implement `MarketplaceListView` sub-component in `packages/code/src/components/PluginManagerUI/MarketplaceListView.tsx`
- [x] T022 [US3] Implement "Add Marketplace" dialog/input in `packages/code/src/components/PluginManagerUI/MarketplaceListView.tsx`
- [x] T023 [US3] Implement marketplace removal logic in `packages/code/src/components/PluginManagerUI/MarketplaceListView.tsx`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T024 [P] Implement `FR-008` (Update plugins) in `InstalledPluginsView.tsx`
- [ ] T025 [P] Add search/filtering (FR-004) to plugin lists in `PluginManagerUI.tsx`
- [ ] T026 Add confirmation dialogs for destructive actions (FR-006) in `PluginManagerUI.tsx`
- [ ] T027 Ensure consistent visual feedback (spinners) for all IO operations (FR-005)
- [ ] T028 Run `quickstart.md` validation and final manual E2E check

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup (T001-T003).
- **User Story 1 (Phase 3)**: Depends on Foundational (T004-T008).
- **User Story 2 (Phase 4)**: Depends on Foundational. Can run in parallel with US1 if needed, but P1 is priority.
- **User Story 3 (Phase 5)**: Depends on Foundational.
- **Polish (Phase 6)**: Depends on all User Stories.

### Parallel Opportunities

- T002 and T003 can be prepared while T001 is being finalized.
- Once Phase 2 is done, US1, US2, and US3 can technically be developed in parallel as they are in separate files.
- All unit tests (T009, T015, T020) can be written in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch tests and sub-components for US1
Task: "Unit test for PluginManagerUI in packages/code/tests/components/PluginManagerUI.test.tsx"
Task: "Implement InstalledPluginsView in packages/code/src/components/PluginManagerUI/InstalledPluginsView.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2 (Setup & Foundation).
2. Complete Phase 3 (User Story 1).
3. **STOP and VALIDATE**: Verify `/plugin` opens UI and allows toggling/removing installed plugins.

### Incremental Delivery

1. Foundation ready.
2. Add US1 (Management) -> MVP.
3. Add US2 (Marketplace/Install) -> Discovery.
4. Add US3 (Marketplace Management) -> Advanced.
5. Polish (Updates, Search, UI feedback).
