# API Contract: Agent SDK `btw()`

## Function Signature

```typescript
/**
 * Launches a side agent to answer a user's question without blocking the main agent.
 * 
 * @param question - The user's question to be answered by the side agent.
 * @param options - Optional configuration for the side agent.
 * @returns A promise that resolves to the side agent's instance ID.
 */
async function btw(
  question: string,
  options?: {
    onMessagesChange?: (messages: Message[]) => void;
    onAssistantContentUpdated?: (content: string) => void;
    onStatusChange?: (status: 'idle' | 'running' | 'completed' | 'error') => void;
  }
): Promise<string>;
```

## Behavior

1. **Instance Creation**: Creates a new `SubagentInstance` with an empty `tools` array.
2. **System Prompt**: Prepends the `BTW_SIDE_QUESTION_SYSTEM_PROMPT` to the side agent's conversation history.
3. **Asynchronous Execution**: Starts the side agent's execution loop in the background.
4. **Multi-turn Support**: Allows sending follow-up questions to the same side agent instance as long as it is active.
5. **Isolation**: Ensures the side agent's message history and state are completely separate from the main agent.
6. **Message Inheritance**: Inherits all messages from the main conversation's history to provide full context for the side agent's response.
