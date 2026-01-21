# Quickstart: Finish Reason Support

## Overview
This feature ensures that the agent can handle truncated responses from the LLM by automatically calling the AI again when the `finish_reason` is `length`. It also persists the `finish_reason` in the message history.

## How to verify

### 1. Run Unit Tests
Run the dedicated test for this feature:
```bash
pnpm -F wave-agent-sdk test tests/managers/aiManager.test.ts
```
(Note: You can also create a specific test file as shown in the implementation phase).

### 2. Manual Verification (Simulated)
You can mock the `callAgent` service to return `finish_reason: 'length'` and verify that `AIManager` calls it again.

```typescript
// Example mock behavior
vi.mocked(callAgent).mockResolvedValueOnce({
  content: "Part 1...",
  finish_reason: "length",
  usage: { ... }
}).mockResolvedValueOnce({
  content: "Part 2.",
  finish_reason: "stop",
  usage: { ... }
});
```

## Key Files
- `packages/agent-sdk/src/types/messaging.ts`: `Message` interface.
- `packages/agent-sdk/src/managers/aiManager.ts`: Recursion logic.
- `packages/agent-sdk/src/services/aiService.ts`: `CallAgentResult` definition.
