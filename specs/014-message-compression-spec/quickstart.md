# Message Compression Quickstart

## How History Compression Works

1.  **Monitor**: `AIManager` checks `usage.total_tokens` against `getMaxInputTokens()`.
2.  **Select**: `getMessagesToCompress(messages)` finds the slice of history to compress.
3.  **Summarize**: `compressMessages` service calls the AI to summarize the selected messages.
4.  **Update**: `messageManager.compressMessagesAndUpdateSession` replaces the old messages with the summary block.

## How Input Compression Works

1.  **Paste**: User pastes > 200 chars.
2.  **Compress**: `InputManager.generateCompressedText` creates `[LongText#ID]`.
3.  **Submit**: User hits Enter.
4.  **Expand**: `InputManager.expandLongTextPlaceholders` restores the original text before `onSendMessage` is called.

## Testing Compression

### History Compression
You can test history compression by mocking the token usage in `AIManager` or by providing a very low `maxInputTokens` value in the agent configuration.

### Input Compression
Paste a long block of text (e.g., a large code file) into the terminal input. You should see it replaced by a `[LongText#1]` placeholder. When you send it, the agent should receive the full text.
