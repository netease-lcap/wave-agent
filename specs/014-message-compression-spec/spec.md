# Message Compression Specification

The message compression system is designed to manage the size of the conversation history and user inputs. This ensures that the agent stays within the token limits of the AI models and maintains a responsive and clean user interface.

## Overview

The system implements two distinct compression strategies:

1.  **Message History Compression**: A server-side (agent-sdk) mechanism that summarizes older parts of the conversation when the total token count exceeds a predefined limit.
2.  **Long User Input Compression**: A client-side (code) mechanism that replaces large pasted text in the input field with placeholders to keep the UI manageable.

## Message History Compression

### Triggering Mechanism
The `AIManager` monitors token usage after each AI response. If the total tokens (including prompt, completion, and cache tokens) exceed the `getMaxInputTokens()` threshold, a compression cycle is initiated.

### Compression Logic
1.  **Identification**: The `getMessagesToCompress` function identifies which messages should be compressed.
2.  **Retention**: It ensures that the last `DEFAULT_KEEP_LAST_MESSAGES_COUNT` (default: 20) valid blocks (text, image, or tool) are kept uncompressed to maintain immediate context.
3.  **Summarization**: The identified messages are sent to the AI with a request to summarize the conversation history.
4.  **Replacement**: The original messages are removed from the active session and replaced with a single assistant message containing a `compress` block. This block holds the summary.
5.  **API Conversion**: When preparing messages for subsequent API calls, `convertMessagesForAPI` detects the `compress` block and prepends it as a `system` message: `[Compressed Message Summary] <summary_content>`.

## Long User Input Compression

### Triggering Mechanism
In the `InputManager`, when a user pastes text longer than 200 characters, the system automatically compresses it.

### Compression Logic
1.  **Placeholder Generation**: The long text is stored in a `longTextMap` and replaced in the input field with a placeholder like `[LongText#1]`.
2.  **UI Representation**: The user sees the placeholder instead of the massive block of text, keeping the input area clean.
3.  **Expansion**: Before the message is sent to the agent (in `handleSubmit`), the `expandLongTextPlaceholders` method replaces all placeholders with their original content from the map.
4.  **Cleanup**: The `longTextMap` is cleared after the message is successfully submitted.

## Configuration

- `DEFAULT_WAVE_MAX_INPUT_TOKENS`: The threshold for triggering history compression.
- `DEFAULT_KEEP_LAST_MESSAGES_COUNT`: The number of recent blocks to preserve (default: 20).
- `PASTE_DEBOUNCE_MS`: Debounce time for processing paste operations (default: 30ms).
- Long text threshold: Hardcoded at 200 characters in `InputManager.ts`.
