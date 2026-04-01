# Data Model: AI Error Handling

## AI Response
The AI response is the primary data structure involved in this feature. It is returned by the `aiService.callAgent` method.

### Attributes:
- `content`: The text content of the response.
- `tool_calls`: A list of tool calls initiated by the AI.
- `finish_reason`: The reason why the AI stopped generating content. Possible values include `"stop"`, `"length"`, `"tool_calls"`, etc.
- `usage`: Token usage statistics for the response.

## Message History
The message history is managed by the `MessageManager` and stores the conversation between the user and the agent.

### Attributes:
- `role`: The role of the message sender (`"user"`, `"assistant"`, or `"system"`).
- `blocks`: A list of message blocks (text, tool, error, etc.).
- `usage`: Token usage statistics for the message.
- `isMeta`: A boolean flag indicating if the message is a meta message (hidden from UI).

## Continuation Prompt
The continuation prompt is a new hidden user message added to the message history when a response is truncated.

### Content:
"Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."
