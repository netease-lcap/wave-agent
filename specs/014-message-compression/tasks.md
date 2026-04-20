# Tasks: Message Compression

**Input**: Design documents from `/specs/014-message-compression/`
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

## Phase 5: Time-Based Microcompact (US2)

**Goal**: Clear old tool result content before API calls when inactivity exceeds threshold.

### Tests for Microcompact (REQUIRED) ⚠️

- [X] T030 Write unit tests for `microcompactMessages()` in `packages/agent-sdk/tests/utils/microcompact.test.ts`

### Implementation for Microcompact

- [X] T031 Create `microcompactMessages()` utility in `packages/agent-sdk/src/utils/microcompact.ts`
- [X] T032 Add `timestamp` field to `ToolBlock` interface in `packages/agent-sdk/src/types/messaging.ts`
- [X] T033 Set `timestamp` on tool result finalization in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T034 Apply `microcompactMessages()` before API calls in `AIManager.sendMessage()`

---

## Phase 6: Compression Circuit Breaker (US3)

**Goal**: Skip compression after consecutive failures to avoid wasting API calls.

### Tests for Circuit Breaker (REQUIRED) ⚠️

- [X] T040 Write tests for circuit breaker behavior in `packages/agent-sdk/tests/agent/agent.compression.test.ts`

### Implementation for Circuit Breaker

- [X] T041 Add `consecutiveCompressionFailures` counter to `AIManager`
- [X] T042 Implement circuit breaker check before compression in `handleTokenUsageAndCompression()`
- [X] T043 Reset counter on successful compression, increment on failure

---

## Phase 7: Post-Compact Context Restoration (US4)

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
