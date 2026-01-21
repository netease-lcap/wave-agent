# Data Model: Finish Reason Support

## Message Interface Updates

The `Message` interface in `packages/agent-sdk/src/types/messaging.ts` is updated to include the `finish_reason`.

```typescript
export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage;
  additionalFields?: Record<string, unknown>;
  finish_reason?: string; // Added field
}
```

## AI Service Result

The `CallAgentResult` in `packages/agent-sdk/src/services/aiService.ts` already supports `finish_reason`.

```typescript
export interface CallAgentResult {
  content?: string;
  tool_calls?: ChatCompletionMessageToolCall[];
  reasoning_content?: string;
  usage?: ClaudeUsage;
  finish_reason?:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "function_call"
    | null;
  response_headers?: Record<string, string>;
  additionalFields?: Record<string, unknown>;
}
```

## Persistence Flow

1.  `callAgent` returns `CallAgentResult` containing `finish_reason`.
2.  `AIManager.sendAIMessage` receives the result.
3.  `AIManager` retrieves the current messages from `MessageManager`.
4.  `AIManager` updates the last assistant message with the `finish_reason`.
5.  `MessageManager.setMessages` is called to persist the change.
6.  `MessageManager.saveSession` is called to write to disk.
