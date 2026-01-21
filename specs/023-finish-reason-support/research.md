# Research: Finish Reason Support

## Current State Analysis

### AI Service (`packages/agent-sdk/src/services/aiService.ts`)
- `CallAgentResult` interface already has a `finish_reason` field.
- `processStreamingResponse` correctly extracts `finish_reason` from OpenAI stream chunks.
- Non-streaming response also extracts `finish_reason` from `response.choices[0]`.

### Messaging Types (`packages/agent-sdk/src/types/messaging.ts`)
- `Message` interface needs to store `finish_reason` to persist it in history.
- This is important for both debugging and for the agent to know why it stopped.

### AI Manager (`packages/agent-sdk/src/managers/aiManager.ts`)
- `sendAIMessage` handles the loop of AI calls.
- Currently, it recurses if `toolCalls.length > 0`.
- It needs to also recurse if `finish_reason === 'length'` to handle truncated responses.

## Proposed Changes

1.  **Persist Finish Reason**: Add `finish_reason?: string` to the `Message` interface.
2.  **Update AIManager**:
    *   Capture `finish_reason` from `callAgent` result.
    *   Store it in the last assistant message.
    *   Add `result.finish_reason === 'length'` to the recursion condition.

## Considerations

- **Recursion Limit**: The existing `recursionDepth` mechanism will prevent infinite loops if the model keeps hitting the length limit without making progress.
- **Streaming vs Non-streaming**: Both modes should behave consistently regarding `finish_reason` persistence and recursion.
- **Token Usage**: Automatic recursion will consume more tokens, but it's necessary for completeness.
