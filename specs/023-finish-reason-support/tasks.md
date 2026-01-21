# Tasks: Finish Reason Support

**Input**: Design documents from `/specs/023-finish-reason-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Unit tests are REQUIRED to verify persistence and recursion logic.

## Phase 1: Setup & Types

- [x] T001 Add `finish_reason?: string` to `Message` interface in `packages/agent-sdk/src/types/messaging.ts`

## Phase 2: Implementation

- [x] T002 Update `AIManager.sendAIMessage` to capture `finish_reason` from `callAgent` result in `packages/agent-sdk/src/managers/aiManager.ts`
- [x] T003 Update `AIManager.sendAIMessage` to persist `finish_reason` to the last assistant message via `messageManager`
- [x] T004 Update `AIManager.sendAIMessage` recursion condition to include `result.finish_reason === 'length'`

## Phase 3: Verification

- [x] T005 Create unit tests to verify `finish_reason` persistence in `packages/agent-sdk/tests/managers/aiManager.test.ts`
- [x] T006 Create unit tests to verify auto-recursion on `length` in `packages/agent-sdk/tests/managers/aiManager.test.ts`
- [x] T007 Run all tests in `wave-agent-sdk` to ensure no regressions
- [x] T008 Run type-check and lint
