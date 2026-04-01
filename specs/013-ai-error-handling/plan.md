# Plan: AI Error Handling

## Implementation Strategy

### 1. Core Logic Changes
Modify `packages/agent-sdk/src/managers/aiManager.ts`:
- **Update Recursion Condition**: Change the condition for recursive `sendAIMessage` calls to include `result.finish_reason === "length"`.
- **Add Continuation Prompt**: Just before the recursive call, if `finish_reason === "length"`, add a hidden user message (with `isMeta: true`): `"Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."`.
- **Update UI Rendering**: Update `packages/code/src/components/MessageList.tsx` to filter out messages with `isMeta: true` before rendering.
- **Duplicate Tool Call Detection**: In `sendAIMessage`, after tool execution and before recursion:
    - Retrieve the message history from `MessageManager`.
    - Find the most recent assistant message (before the current one) that contains tool blocks.
    - Compare the current turn's tool calls (name and arguments) with the tool calls in that previous assistant message.
    - If any tool call is identical (same name and same arguments), append a reminder to the tool result:
      `"\n\nNote: You just called this tool with the same arguments in the previous turn. Please ensure you are not in a loop and consider if you need to change your approach."`

### 2. Test Updates
- **`packages/agent-sdk/tests/managers/aiManager_finishReason.test.ts`**:
    - Update `should add an error block when finish reason is length and no tools are called` to also expect `addUserMessage` and recursion.
    - Update other related tests to reflect the new behavior.
- **`packages/agent-sdk/tests/managers/aiManager.test.ts`**:
    - Update `should log warning when finish reason is length` to also verify `addUserMessage` and recursion.
- **`packages/agent-sdk/tests/managers/aiManager_duplicateTool.test.ts`**:
    - Test case: Verify that a reminder message is added when the same tool is called with the same arguments in consecutive turns.
    - Test case: Verify that no reminder is added when the tool name is the same but arguments are different.
    - Test case: Verify that no reminder is added when the tool name is different.
    - Test case: Verify that the reminder includes all duplicate tool names.

## Verification Plan
1. **Unit Tests**: Run the updated tests using `pnpm test packages/agent-sdk/tests/managers/aiManager_finishReason.test.ts` and `pnpm test packages/agent-sdk/tests/managers/aiManager.test.ts`.
2. **Manual Verification**: (If possible in this environment) Simulate a truncated response and verify that the agent automatically adds the continuation message and makes another AI call.
