# Research: Message Compression

**Decision**: Implement history compression via AI summarization and input compression via placeholders.

**Rationale**: 
- Token limits are a hard constraint for AI models; history compression is necessary for long conversations.
- Pasting large blocks of text (e.g., logs or code) makes the terminal input unusable; placeholders solve this.
- Summarization preserves the "essence" of the conversation better than simply truncating old messages.

**Alternatives Considered**:
- **Truncation**: Simply deleting old messages. Rejected because it leads to complete loss of context.
- **Vector Search (RAG)**: Storing old messages in a vector DB. Rejected as too complex for the initial implementation, though it could be a future enhancement.

## Findings

### History Compression
- **Trigger**: Based on `usage.total_tokens` from the AI response.
- **Retention**: Keeping the last 20 blocks ensures the agent remembers the most recent context perfectly.
- **Summarization**: The agent is asked to "Summarize the following conversation history concisely, preserving key facts, decisions, and file paths."

### Input Compression
- **Trigger**: 200-character threshold for paste events.
- **Placeholder**: `[LongText#ID]` is used as it's unlikely to occur naturally in user input.
- **Expansion**: Must happen just before the message is sent to ensure the agent receives the full content.

### Integration Points
- **AIManager**: Monitors tokens and calls the summarization service.
- **MessageManager**: Updates the session with the new `compress` block.
- **InputManager**: Manages the `longTextMap` and placeholder replacement.
- **API Utilities**: Convert `compress` blocks into system messages for the AI.
