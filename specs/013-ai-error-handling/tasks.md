# Tasks: AI Error Handling

- [x] Find truncation message implementation
- [x] Design implementation for AI response continuation on truncation
- [x] Remove old error block logic in `AIManager.ts`
- [x] Update recursion condition in `AIManager.ts` to include `finish_reason === "length"`
- [x] Add continuation user message in `AIManager.ts` when truncated and no tools were called
- [x] Update tests in `packages/agent-sdk/tests/managers/aiManager_finishReason.test.ts`
- [x] Update tests in `packages/agent-sdk/tests/managers/aiManager.test.ts`
- [x] Verify all tests pass
