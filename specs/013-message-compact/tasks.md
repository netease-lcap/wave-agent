# Tasks: Message Compact

**Input**: Design documents from `/specs/013-message-compact/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Research existing compression logic in `agent-sdk` and `code`
- [X] T002 Document history compression mechanism in `spec.md`
- [X] T004 Define data models for `compress` blocks in `data-model.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T005 [P] Create unit test file for compression logic in `packages/agent-sdk/tests/agent/agent.compression.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Automatic History Compression (Priority: P1) 🎯 MVP

**Goal**: Enable automatic summarization of old messages.

**Independent Test**: Mock token usage and verify compression is triggered.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T007 [US1] Write tests for `AIManager` triggering compression
- [X] T008 [US1] Write tests for `compress` block conversion to API format

### Implementation for User Story 1

- [X] T009 [US1] Implement `getMessagesToCompress` logic in `packages/agent-sdk/src/utils/messageOperations.ts`
- [X] T010 [US1] Implement summarization call in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T011 [US1] Implement `compress` block handling in `convertMessagesForAPI`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: API-Round Grouping (US1 Enhancement)

**Goal**: Replace fixed `slice(-3)` cutoff with API-round-based message preservation.

### Tests for API-Round Grouping (REQUIRED) ⚠️

- [X] T020 Write unit tests for `groupMessagesByApiRound()` in `packages/agent-sdk/tests/utils/groupMessagesByApiRound.test.ts`
- [X] T021 Write unit tests for `getLastApiRounds()` in same file

### Implementation for API-Round Grouping

- [X] T022 Create `groupMessagesByApiRound()` utility in `packages/agent-sdk/src/utils/groupMessagesByApiRound.ts`
- [X] T023 Update `compressMessagesAndUpdateSession()` to use `getLastApiRounds(messages, 2)` instead of `slice(-3)` in `packages/agent-sdk/src/managers/messageManager.ts`

---

## Phase 6: Compression Circuit Breaker (US2)

**Goal**: Skip compression after consecutive failures to avoid wasting API calls.

### Tests for Circuit Breaker (REQUIRED) ⚠️

- [X] T040 Write tests for circuit breaker behavior in `packages/agent-sdk/tests/agent/agent.compression.test.ts`

### Implementation for Circuit Breaker

- [X] T041 Add `consecutiveCompressionFailures` counter to `AIManager`
- [X] T042 Implement circuit breaker check before compression in `handleTokenUsageAndCompression()`
- [X] T043 Reset counter on successful compression, increment on failure

---

## Phase 7: Post-Compact Context Restoration (US3)

**Goal**: Re-inject important context after compression.

### Tests for Context Restoration (REQUIRED) ⚠️

- [X] T050 Verify context restoration sections in compression test in `packages/agent-sdk/tests/agent/agent.compression.test.ts`
- [X] T051 Write tests for `getRecentFileReads()` in `packages/agent-sdk/tests/managers/messageManager.coverage.test.ts`

### Implementation for Context Restoration

- [X] T052 Add `recentFileReads` tracking and `getRecentFileReads()` method in `packages/agent-sdk/src/managers/messageManager.ts`
- [X] T053 Build post-compact context restoration (files, working dir, plan mode, skills, background tasks) in `handleTokenUsageAndCompression()`
- [X] T054 Strip images from messages before compress API call in `packages/agent-sdk/src/services/aiService.ts`
- [X] T055 Use fast model for compression in `handleTokenUsageAndCompression()`

---

## Phase 8: Integration Tests

- [X] T060 Write integration tests for full compaction pipeline in `packages/agent-sdk/tests/integration/compactionFlow.test.ts`

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T017 [P] Investigate if image metadata should be preserved in summaries
- [ ] T018 [P] Final type-check and linting

---

## Phase 10: User Story 5 - Manual `/compact` Command (Priority: P2)

**Goal**: Enable manual compaction via `/compact` slash command with optional custom instructions

**Independent Test**: Type `/compact` or `/compact custom instructions`, verify compaction occurs

### Implementation for User Story 5

- [X] T070 [US5] Extract `compactConversation()` public method in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T071 [US5] Extract `buildPostCompactContext()` private helper from `handleTokenUsageAndCompaction()` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T072 [US5] Refactor `handleTokenUsageAndCompaction()` to delegate to `compactConversation()` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T073 [US5] Add `customInstructions` to `CompactMessagesOptions` in `packages/agent-sdk/src/services/aiService.ts`
- [X] T074 [US5] Add `/compact` as CLI-internal command via `Agent.compact()` in `packages/agent-sdk/src/agent.ts`, registered in `AVAILABLE_COMMANDS` in CLI

---

## Phase 11: User Story 6 - PreCompact and PostCompact Hook Events (Priority: P2)

**Goal**: Enable hooks before and after conversation compaction

**Independent Test**: Configure PreCompact/PostCompact hooks, trigger compaction, verify execution order

### Implementation for User Story 6

- [X] T080 [US6] Add `PreCompact` and `PostCompact` to `HookEvent` type in `packages/agent-sdk/src/types/hooks.ts`
- [X] T081 [US6] Add `compactInstructions`, `compactSummary` to `ExtendedHookExecutionContext` and `HookJsonInput` in `packages/agent-sdk/src/types/hooks.ts`
- [X] T082 [US6] Update `HookManager` for PreCompact/PostCompact events (configApplies, validateEventConfig, handleBlockingError, getConfigurationStats) in `packages/agent-sdk/src/managers/hookManager.ts`
- [X] T083 [US6] Add `executePreCompactHooks()` and `executePostCompactHooks()` convenience methods in `packages/agent-sdk/src/managers/hookManager.ts`
- [X] T084 [US6] Wire PreCompact and PostCompact hooks into `compactConversation()` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T085 [US6] Add tests for `compactConversation` in `packages/agent-sdk/tests/managers/aiManager.compactConversation.test.ts`
