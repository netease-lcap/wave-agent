# Tasks: Modular Memory Rules

## Phase 1: Setup
- [X] T001 Define `MemoryRule` and `MemoryRuleMetadata` types in `packages/agent-sdk/src/types/memoryRule.ts`
- [X] T002 Export `MemoryRule` and `MemoryRuleMetadata` from `packages/agent-sdk/src/index.ts`

## Phase 2: Foundational
- [X] T003 [P] Implement `MemoryRuleService.parseRule` using `markdownParser.ts` in `packages/agent-sdk/src/services/MemoryRuleService.ts`
- [X] T004 [P] Implement `MemoryRuleService.isMatch` using `minimatch` in `packages/agent-sdk/src/services/MemoryRuleService.ts`
- [X] T005 [P] Create unit tests for `MemoryRuleService` in `packages/agent-sdk/tests/MemoryRuleService.test.ts`
- [X] T006 Implement `MemoryRuleManager` skeleton with basic registry state in `packages/agent-sdk/src/managers/MemoryRuleManager.ts`

## Phase 3: User Story 1 - Project-Level Modular Memory Rules (P1)
**Goal**: Load all `.md` files from `.wave/rules/` as project memory.
**Independent Test**: Create `.wave/rules/test.md`, verify it's loaded and included in the agent's system prompt.

- [X] T007 [US1] Implement basic discovery of `.md` files in `.wave/rules/` in `MemoryRuleManager.ts`
- [X] T008 [US1] Implement `MemoryRuleManager.getActiveRules` to return all rules without path restrictions
- [X] T009 [US1] Integrate `MemoryRuleManager` into `Agent` class in `packages/agent-sdk/src/agent.ts`
- [X] T010 [US1] Update `AIManager` to include active memory rules in the system prompt in `packages/agent-sdk/src/managers/AIManager.ts`
- [X] T011 [US1] Create unit tests for project-level rule loading in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

## Phase 4: User Story 2 - Path-Specific Memory Rules (P1)
**Goal**: Activate memory rules only when working with matching files.
**Independent Test**: Create a rule with `paths: ["src/*.ts"]`, verify it's active when reading `src/main.ts` but inactive for `README.md`.

- [X] T012 [P] [US2] Update `MemoryRuleManager.getActiveRules` to filter rules based on `filesInContext`
- [X] T013 [US2] Ensure `AIManager` passes current context files to `getActiveRules`
- [X] T014 [US2] Create unit tests for path-specific matching in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

## Phase 5: User Story 3 - Memory Rule Organization in Subdirectories (P2)
**Goal**: Support immediate subdirectories and symlinks in `.wave/rules/`.
**Independent Test**: Create `.wave/rules/subdir/rule.md` and a symlink, verify both are discovered.

- [X] T015 [US3] Update discovery logic in `MemoryRuleManager.ts` to include immediate subdirectories
- [X] T016 [US3] Implement symlink resolution and circularity detection in `MemoryRuleManager.ts`
- [X] T017 [US3] Create unit tests for subdirectory and symlink discovery in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

## Phase 6: User Story 4 - User-Level Memory Rules (P2)
**Goal**: Load global memory rules from `~/.wave/rules/`.
**Independent Test**: Create `~/.wave/rules/global.md`, verify it's loaded in any project but overridden by project rules if applicable.

- [X] T018 [US4] Implement discovery of memory rules from `~/.wave/rules/` in `MemoryRuleManager.ts`
- [X] T019 [US4] Implement prioritization logic (project rules > user rules) in `MemoryRuleManager.ts`
- [X] T020 [US4] Create unit tests for user-level rules and prioritization in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

## Phase 7: Polish & Cross-Cutting Concerns
- [X] T021 [P] Implement error handling for malformed YAML frontmatter in `MemoryRuleService.ts`
- [X] T022 Create end-to-end integration tests in `packages/code/tests/MemoryRules.test.ts`
- [X] T023 Run `pnpm run type-check` and `pnpm run lint` across the workspace
- [X] T024 Run all tests with `pnpm test`

## Dependencies
- US1 is the foundation for all other stories.
- US2 depends on US1.
- US3 and US4 are independent but depend on US1.

## Parallel Execution Examples
- **Phase 2**: T003, T004, and T005 can be worked on simultaneously.
- **Phase 4 & 7**: T012 and T021 can be worked on in parallel.

## Implementation Strategy
- **MVP**: Complete Phases 1, 2, and 3 to enable basic modular rules.
- **Incremental**: Add path-scoping (Phase 4), then organizational features (Phase 5), and finally global rules (Phase 6).
