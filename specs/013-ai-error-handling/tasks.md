# Tasks: AI Error Handling

- [x] Find truncation message implementation
- [x] Design implementation for AI response continuation on truncation
- [x] Update recursion condition in `AIManager.ts` to include `finish_reason === "length"`
- [x] Add continuation user message in `AIManager.ts` when truncated and no tools were called
- [x] Update tests in `packages/agent-sdk/tests/managers/aiManager_finishReason.test.ts`
- [x] Update tests in `packages/agent-sdk/tests/managers/aiManager.test.ts`
- [x] Verify all tests pass
- [x] Implement duplicate tool call detection logic in `AIManager.ts`
- [x] Add duplicate tool call reminder user message in `AIManager.ts`
- [x] Create unit tests for duplicate tool call reminder in `packages/agent-sdk/tests/managers/aiManager_duplicateTool.test.ts`
- [x] Verify duplicate tool call reminder implementation
