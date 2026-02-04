# Implementation Plan: Plugin Management UI

**Feature Branch**: `060-plugin-management-ui`  
**Created**: 2026-02-04  
**Status**: Draft  
**Feature Spec**: [spec.md](./spec.md)

## Technical Context

### Architecture Overview
The feature will be implemented as a standalone Ink-based CLI component in the `code` package, leveraging existing services in the `agent-sdk` package.

- **Frontend**: React Ink components in `packages/code/src/components/`.
- **Hooks**: Custom hooks in `packages/code/src/hooks/`.
- **Contexts**: React contexts in `packages/code/src/contexts/`.
- **CLI Entry Point**: `packages/code/src/plugin-manager-cli.tsx`.
- **Backend Services**: `MarketplaceService` and `PluginScopeManager` in `packages/agent-sdk`.

### Dependencies
- `agent-sdk`: `MarketplaceService`, `PluginScopeManager`, `ConfigurationService`.
- `code`: `ink`, `ink-select-input` (or custom selection logic), `ink-text-input`.

### Unknowns & Research
- [x] How to handle navigation between "Discover", "Installed", and "Marketplaces" views in Ink (Implemented via `Tab` and `Shift+Tab`).
- [x] How to integrate `MarketplaceService` methods with the UI state.
- [x] How to handle the "Add Marketplace" input flow in Ink.
- [x] How to handle multi-scope installation (Implemented via arrow key selection in detail view).

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Package-First | ✅ | UI in `code`, logic in `agent-sdk`. |
| II. TypeScript | ✅ | Strict typing for all components and hooks. |
| III. Test Alignment | ✅ | Unit tests for components, integration tests for CLI entry. |
| IV. Build Deps | ✅ | Will build `agent-sdk` before testing `code`. |
| V. Doc Minimalism | ✅ | No extra docs beyond required spec/plan. |
| VI. Quality Gates | ✅ | Will run lint/type-check. |
| VII. Source Structure | ✅ | Following flattened `components/`, `hooks/`, and `contexts/` pattern in `code`. |
| X. Data Model Minimalism | ✅ | Using existing `Plugin` and `Marketplace` types. |
| XI. Planning with GP Agent | ✅ | Research and design validated by GP agent. |

## Phase 0: Research & Refinement

### Research Findings (Consolidated)
- **Decision**: Use a state-based navigation system within a single Ink `render` session.
- **Rationale**: Simplifies state management and provides a smoother CLI experience compared to multiple `render` calls.
- **Alternatives**: Sub-commands (e.g., `wave plugin list`). Rejected because the user requested a standalone interactive component like `session-selector-cli.tsx`.

## Phase 1: Design & Contracts

### Data Model (`data-model.md` summary)
- **View State**: `DISCOVER | INSTALLED | MARKETPLACES | PLUGIN_DETAIL | ADD_MARKETPLACE`.
- **Selection State**: Currently selected item index, current list of items.
- **Action State**: `IDLE | LOADING | SUCCESS | ERROR`.

### API Contracts (Internal)
- `PluginManagerUI`: Main component.
- `usePluginManager`: Custom hook to wrap `MarketplaceService` and `PluginScopeManager` calls.
- `startPluginManagerCli()`: Entry point function.

## Phase 2: Implementation Strategy

### Step 1: agent-sdk Enhancements (if needed)
- Verify `MarketplaceService` has all necessary methods: `getMarketplaces()`, `addMarketplace()`, `removeMarketplace()`, `getPluginsFromMarketplace()`, `installPlugin()`.
- Verify `PluginScopeManager` has: `getInstalledPlugins()`, `enablePlugin()`, `disablePlugin()`, `uninstallPlugin()`.

### Step 2: UI Components
- `PluginManagerShell`: Main layout with tabs.
- `PluginList`: Generic list component for plugins and marketplaces.
- `PluginDetail`: Detail view with action buttons.
- `MarketplaceAddForm`: Input form for new marketplaces.

### Step 3: CLI Integration
- Add `plugin` command to `packages/code/src/index.ts`.
- Implement `packages/code/src/plugin-manager-cli.tsx`.

## Phase 3: Testing & Validation
- Unit tests for UI components using `HookTester` and `ink-testing-library`.
- Integration test for the `wave plugin` command flow.
- Functional example in `packages/code/examples/plugin-manager.ts`.
