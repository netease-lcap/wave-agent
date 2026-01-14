# Tasks: GitHub Marketplace Support

**Feature**: GitHub Marketplace Support
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

## Phase 1: Setup

- [x] T001 Initialize feature branch and verify project structure
- [x] T002 Ensure `git` CLI is available in the environment for `agent-sdk`

## Phase 2: Foundational

- [x] T003 Update `MarketplaceOwner` and `MarketplacePluginEntry` types in `packages/agent-sdk/src/types/marketplace.ts`
- [x] T004 Update `KnownMarketplace` type to use a structured `source` object in `packages/agent-sdk/src/types/marketplace.ts`
- [x] T005 Implement `GitService` in `packages/agent-sdk/src/services/GitService.ts` to handle `git clone` and `git pull` operations

## Phase 3: User Story 1 - Add GitHub Marketplace

**Goal**: Allow users to add a GitHub repository as a marketplace using `owner/repo` format.
**Independent Test**: Run `wave plugin marketplace add owner/repo` and verify it's registered.

- [x] T006 [P] [US1] Implement GitHub repository URL resolution logic in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T007 [US1] Implement `addMarketplace` logic for GitHub repositories (cloning to `~/.wave/plugins/marketplaces/`) in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T008 [US1] Update `addMarketplaceCommand` in `packages/code/src/commands/plugin/marketplace.ts` to handle GitHub format
- [x] T009 [US1] Update `yargs` command registration for `marketplace add` in `packages/code/src/index.ts` to support GitHub repositories
- [x] T010 [US1] Add unit tests for adding GitHub marketplaces in `packages/agent-sdk/tests/services/MarketplaceService.test.ts`

## Phase 4: User Story 2 - Install Plugin from GitHub Marketplace

**Goal**: Support installing plugins that have GitHub repositories as their source.
**Independent Test**: Install a plugin with a GitHub source and verify it's functional.

- [x] T011 [US2] Update `installPlugin` in `packages/agent-sdk/src/services/MarketplaceService.ts` to resolve plugin sources relative to the marketplace root
- [x] T012 [US2] Ensure `installPlugin` correctly handles marketplaces with different source types (directory vs github)
- [x] T013 [US2] Add unit tests for installing plugins from GitHub sources in `packages/agent-sdk/tests/services/MarketplaceService.test.ts`

## Phase 5: User Story 3 - Update Marketplace

**Goal**: Provide a command to update registered marketplaces from their sources.
**Independent Test**: Run `wave plugin marketplace update` and verify manifests are refreshed.

- [x] T014 [US3] Implement `updateMarketplace` and `updateAllMarketplaces` logic in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T015 [US3] Implement `updateMarketplaceCommand` in `packages/code/src/commands/plugin/marketplace.ts`
- [x] T016 [US3] Register `marketplace update [name]` command in `packages/code/src/index.ts`
- [x] T017 [US3] Add unit tests for updating marketplaces in `packages/agent-sdk/tests/services/MarketplaceService.test.ts`

## Phase 6: Polish & Cross-cutting Concerns

- [x] T018 [P] Implement robust error handling for GitHub rate limits and private repositories in `packages/agent-sdk/src/services/MarketplaceService.ts`
- [x] T019 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [x] T021 Ensure compatibility with non-git systems by skipping GitHub operations when git is missing

## Dependencies

- US1 (Add) must be completed before US2 (Install) and US3 (Update) can be fully tested with GitHub sources.
- Foundational tasks (T003-T005) are prerequisites for all User Stories.

## Parallel Execution Examples

- T006 (URL resolution) can be done in parallel with T003-T004 (Type updates).
- T018 (Error handling) can be worked on alongside User Story implementations.

## Implementation Strategy

- **MVP**: Focus on User Story 1 (Add GitHub Marketplace) first to establish the cloning and registry logic.
- **Incremental**: Follow with User Story 2 (Install) to enable the core value of the marketplace.
- **Polish**: Add User Story 3 (Update) and robust error handling last.
