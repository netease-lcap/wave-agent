# Quickstart: AI Error Handling

## Overview
This feature improves the agent's behavior when its response is truncated due to the output token limit. Instead of showing an error message and stopping, the agent now automatically adds a continuation prompt and makes another AI call to finish its response.

## How it Works
1. The AI service returns a response with `finish_reason: "length"`.
2. The `AIManager` detects this truncation.
3. If no tools were called, the `AIManager` adds a user message: "Your response was cut off because it exceeded the output token limit. Please break your work into smaller pieces. Continue from where you left off."
4. The `AIManager` then automatically initiates a recursive `sendAIMessage` call.
5. If tools were called, the `AIManager` still initiates the recursive call after tool execution, but without adding the extra user message.

## Testing
To test this feature, you can simulate a truncated response in a unit test:
```typescript
vi.mocked(callAgent).mockResolvedValueOnce({
  content: "Truncated response...",
  finish_reason: "length",
  tool_calls: [],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});
```
Verify that `addUserMessage` is called with the continuation prompt and that `callAgent` is called again.
