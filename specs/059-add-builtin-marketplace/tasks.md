# Tasks: Add Builtin Marketplace

**Input**: Design documents from `/specs/059-add-builtin-marketplace/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Verify existing marketplace types in packages/agent-sdk/src/types/marketplace.ts
- [x] T002 [P] Create test directory for MarketplaceService in packages/agent-sdk/tests/services/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Define BUILTIN_MARKETPLACE constant in packages/agent-sdk/src/services/MarketplaceService.ts
- [x] T004 [P] Add isBuiltin optional flag to KnownMarketplace interface in packages/agent-sdk/src/types/marketplace.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Access Builtin Marketplace (Priority: P1) 🎯 MVP

**Goal**: Ensure `wave-plugins-official` is available by default on fresh installations.

**Independent Test**: Run `wave plugin marketplace list` on a fresh installation (no config file) and verify the builtin marketplace is present.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T005 [P] [US1] Create unit test for getKnownMarketplaces defaulting to builtin in packages/agent-sdk/tests/services/MarketplaceService.test.ts
- [ ] T006 [P] [US1] Create integration test for CLI marketplace list command in packages/code/tests/commands/plugin/marketplace.test.ts

### Implementation for User Story 1

- [x] T007 [US1] Modify getKnownMarketplaces to return builtin if config file is missing in packages/agent-sdk/src/services/MarketplaceService.ts
- [x] T008 [US1] Update listMarketplaces to include builtin flag in packages/agent-sdk/src/services/MarketplaceService.ts
- [x] T009 [US1] Verify CLI list command displays builtin marketplace correctly in packages/code/src/commands/plugin/marketplace.ts

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Persistence of Builtin Marketplace (Priority: P2)

**Goal**: Ensure the builtin marketplace remains available when other marketplaces are added.

**Independent Test**: Add a custom marketplace and verify both the builtin and custom ones are listed.

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] T010 [P] [US2] Create unit test for addMarketplace persisting builtin marketplace in packages/agent-sdk/tests/services/MarketplaceService.test.ts
- [ ] T011 [P] [US2] Create integration test for adding custom marketplace while keeping builtin in packages/code/tests/commands/plugin/marketplace.test.ts

### Implementation for User Story 2

- [x] T012 [US2] Update addMarketplace to ensure builtin is included in the first save to packages/agent-sdk/src/services/MarketplaceService.ts
- [x] T013 [US2] Implement deduplication logic in addMarketplace to handle name conflicts in packages/agent-sdk/src/services/MarketplaceService.ts

**Checkpoint**: User Stories 1 and 2 work independently and together.

---

## Phase 5: User Story 3 - Management of Builtin Marketplace (Priority: P3)

**Goal**: Allow users to remove the builtin marketplace.

**Independent Test**: Remove `wave-plugins-official` and verify it no longer appears in the list.

### Tests for User Story 3 (REQUIRED) ⚠️

- [x] T014 [P] [US3] Create unit test for removing builtin marketplace in packages/agent-sdk/tests/services/MarketplaceService.test.ts
- [ ] T015 [P] [US3] Create integration test for CLI marketplace remove command in packages/code/tests/commands/plugin/marketplace.test.ts

### Implementation for User Story 3

- [x] T016 [US3] Update removeMarketplace to allow filtering out the builtin marketplace in packages/agent-sdk/src/services/MarketplaceService.ts
- [x] T017 [US3] Ensure removal persists to known_marketplaces.json in packages/agent-sdk/src/services/MarketplaceService.ts

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T018 [P] Run pnpm build in packages/agent-sdk/ to propagate changes
- [x] T019 [P] Run pnpm run type-check and pnpm lint across the monorepo
- [x] T020 [P] Update examples/marketplace-usage.ts if applicable
- [x] T021 Run quickstart.md validation to ensure all scenarios work as documented

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
  - US1 (P1) is the MVP.
  - US2 and US3 can proceed in parallel after US1 or sequentially.
- **Polish (Final Phase)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Foundation for all other stories.
- **User Story 2 (P2)**: Enhances US1 by adding persistence.
- **User Story 3 (P3)**: Enhances US1/US2 by adding removal capability.

### Parallel Opportunities

- T001, T002 (Setup)
- T004 (Foundational)
- T005, T006 (US1 Tests)
- T010, T011 (US2 Tests)
- T014, T015 (US3 Tests)
- T018, T019, T020 (Polish)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Create unit test for getKnownMarketplaces defaulting to builtin in packages/agent-sdk/tests/services/MarketplaceService.test.ts"
Task: "Create integration test for CLI marketplace list command in packages/code/tests/commands/plugin/marketplace.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2.
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: Verify builtin marketplace appears on fresh install.

### Incremental Delivery

1. Foundation -> US1 (MVP) -> US2 (Persistence) -> US3 (Removal) -> Polish.
