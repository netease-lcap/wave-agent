# Plan: AI Error Handling

## Implementation Strategy

### 1. Core Logic Changes
Modify `packages/agent-sdk/src/managers/aiManager.ts`:
- **Remove Error Block**: Delete the logic that adds an error block when `finish_reason === "length"` and `toolCalls.length === 0`.
- **Update Recursion Condition**: Change the condition for recursive `sendAIMessage` calls to include `result.finish_reason === "length"`.
- **Add Continuation Prompt**: Just before the recursive call, if `finish_reason === "length"` AND `toolCalls.length === 0`, add a user message: `"Your response was cut off because it exceeded the output token limit. Please break your work into smaller pieces. Continue from where you left off."`. If `toolCalls.length > 0`, the tool results will serve as the reminder for the AI to continue, so no extra user message is needed.

### 2. Test Updates
- **`packages/agent-sdk/tests/managers/aiManager_finishReason.test.ts`**:
    - Update `should add an error block when finish reason is length and no tools are called` to expect `addUserMessage` and recursion instead of `addErrorBlock`.
    - Update other related tests to reflect the new behavior.
- **`packages/agent-sdk/tests/managers/aiManager.test.ts`**:
    - Update `should log warning when finish reason is length` to also verify `addUserMessage` and recursion.

## Verification Plan
1. **Unit Tests**: Run the updated tests using `pnpm test packages/agent-sdk/tests/managers/aiManager_finishReason.test.ts` and `pnpm test packages/agent-sdk/tests/managers/aiManager.test.ts`.
2. **Manual Verification**: (If possible in this environment) Simulate a truncated response and verify that the agent automatically adds the continuation message and makes another AI call.
