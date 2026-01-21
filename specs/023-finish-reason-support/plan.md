# Plan: Finish Reason Support

## Phase 1: Type Updates
- Update `Message` interface in `packages/agent-sdk/src/types/messaging.ts` to include `finish_reason`.

## Phase 2: AIManager Implementation
- Modify `sendAIMessage` in `packages/agent-sdk/src/managers/aiManager.ts`.
- Capture `finish_reason` from `callAgent` result.
- Update the last assistant message in `MessageManager` with the `finish_reason`.
- Update the recursion condition to include `result.finish_reason === 'length'`.

## Phase 3: Verification
- Create unit tests in `packages/agent-sdk/tests/managers/aiManager.finishReason.test.ts` (or similar).
- Verify that `finish_reason` is saved.
- Verify that recursion occurs on `length`.
- Run all existing tests to ensure no regressions.
