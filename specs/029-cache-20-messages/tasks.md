# Tasks: Improved Message Cache Strategy

**Input**: Design documents from `/specs/029-cache-20-messages/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project preparation for breaking changes

- [X] T001 [P] Backup current `packages/agent-sdk/src/utils/cacheControlUtils.ts` for reference
- [X] T002 [P] Backup current `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts` for reference

---

## Phase 2: Foundational (Breaking Change Preparation)

**Purpose**: Remove legacy code that MUST be deleted before implementation

**⚠️ CRITICAL**: All legacy cache control code must be removed before new implementation

- [X] T003 Delete `CacheControlConfig` interface entirely from `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T004 Delete `DEFAULT_CACHE_CONTROL_CONFIG` constant entirely from `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T005 Delete `findRecentUserMessageIndices` function entirely from `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T006 Delete `addCacheControlToRecentUserMessages` function entirely from `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T007 Remove all legacy cache control logic from `transformMessagesForClaudeCache` function in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T008 Remove all legacy tests from `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts`

**Checkpoint**: Legacy code completely removed - ready for new implementation

---

## Phase 3: User Story 1 - Enhanced Cache for Long-Running Tasks (Priority: P1) 🎯 MVP

**Goal**: Replace user message caching with interval-based caching (every 20th message) using sliding window approach

**Independent Test**: Create a conversation with 40 messages and verify cache marker is only on 40th message (20th marker removed)

### Implementation for User Story 1

- [X] T009 [P] [US1] Implement `findIntervalMessageIndex` function returning single number in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T010 [US1] Implement hardcoded cache strategy in `transformMessagesForClaudeCache` function in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T011 [US1] Add last system message detection logic in `transformMessagesForClaudeCache` function in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T012 [US1] Add sliding window cache marker application logic in `transformMessagesForClaudeCache` function in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T013 [US1] Update function signature to remove config parameter from `transformMessagesForClaudeCache` in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T014 [US1] Implement acceptance scenario validation: no cache for < 20 messages in `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts`
- [X] T015 [US1] Implement acceptance scenario validation: cache 20th message exactly in `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts`
- [X] T016 [US1] Implement acceptance scenario validation: maintain 20th cache for 39 messages in `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts`
- [X] T017 [US1] Implement acceptance scenario validation: move cache to 40th message (sliding window) in `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts`
- [X] T018 [US1] Add edge case tests for empty conversations and mixed message types in `packages/agent-sdk/tests/utils/cacheControlUtils.test.ts`

**Checkpoint**: Interval-based cache control is fully functional and independently testable

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Finalize implementation and ensure system integration

- [X] T019 [P] Update any consuming code that calls `transformMessagesForClaudeCache` to remove config parameters
- [X] T020 [P] Verify TypeScript compilation passes with no configuration interface references
- [X] T021 Run full test suite to ensure no breaking changes affect other components
- [X] T022 [P] Clean up unused imports and helper functions in `packages/agent-sdk/src/utils/cacheControlUtils.ts`
- [X] T023 Run quickstart.md validation scenarios to verify feature completeness

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS user story implementation
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion - all legacy code must be removed first
- **Polish (Phase 4)**: Depends on User Story 1 completion

### User Story Dependencies

- **User Story 1 (P1)**: Single story implementation - no dependencies on other stories

### Within User Story 1

- Tests (T014-T018) can run in parallel after core implementation (T009-T013)
- Core functions (T009) before integration logic (T010-T013)
- Function implementation before signature changes (T013)
- Implementation before test validation (T014-T018)

### Parallel Opportunities

- All Setup tasks (T001-T002) can run in parallel
- Core implementation tasks (T009) and test writing (T014-T018) can run in parallel
- Polish tasks (T019-T023) can run in parallel after core implementation

---

## Parallel Example: User Story 1

```bash
# After T009-T013 complete, launch validation tests together:
Task: "Implement acceptance scenario validation: no cache for < 20 messages"
Task: "Implement acceptance scenario validation: cache 20th message exactly"  
Task: "Implement acceptance scenario validation: maintain 20th cache for 39 messages"
Task: "Implement acceptance scenario validation: move cache to 40th message (sliding window)"

# Launch polish tasks together:
Task: "Update any consuming code that calls transformMessagesForClaudeCache"
Task: "Verify TypeScript compilation passes with no configuration interface references"
Task: "Clean up unused imports and helper functions"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational - DELETE all legacy code (T003-T008) 
3. Complete Phase 3: User Story 1 implementation (T009-T018)
4. **STOP and VALIDATE**: Test interval-based caching with 19/20/39/40 message scenarios
5. Complete Phase 4: Polish and integration (T019-T023)

### Key Validation Points

1. **After T008**: Verify all legacy code removed, TypeScript compilation may fail (expected)
2. **After T013**: Verify core hardcoded functionality works independently  
3. **After T018**: Verify all acceptance scenarios pass as specified in spec.md
4. **After T023**: Verify complete system integration with no regressions

### Critical Success Criteria

- [ ] **FR-001**: System tracks total message count (not just user messages)
- [ ] **FR-002**: Cache marker created at multiples of 20 (20, 40, 60, etc.)
- [ ] **FR-003**: No cache markers when < 20 messages or not multiple of 20
- [ ] **FR-004**: Sliding window behavior - only latest interval cached
- [ ] **FR-007**: Cache markers update when reaching next 20-message interval
- [ ] **Breaking Change**: No backward compatibility - clean replacement only

---

## Notes

- [P] tasks = different files, no dependencies
- [US1] tasks map to User Story 1 from spec.md for traceability
- This is a breaking change implementation - no fallback or migration code
- Hardcoded values: system messages always cached, tools always cached, interval = 20
- Focus on sliding window behavior: only the LATEST interval position gets cached
- Verify against acceptance scenarios: 19→no cache, 20→cache 20th, 39→keep 20th, 40→move to 40th