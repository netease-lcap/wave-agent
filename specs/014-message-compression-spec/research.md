# Message Compression Research

## Current Implementation Analysis

### History Compression
- **Location**: `packages/agent-sdk/src/managers/aiManager.ts`, `packages/agent-sdk/src/utils/messageOperations.ts`.
- **Algorithm**: It uses a "sliding window" approach where it keeps the most recent $N$ blocks and compresses everything before them.
- **Recursive Compression**: If a compression block already exists, the new compression cycle includes the old compression block in the messages to be summarized, effectively creating a rolling summary.

### Input Compression
- **Location**: `packages/code/src/managers/InputManager.ts`.
- **Threshold**: 200 characters. This is currently a hardcoded value.
- **Debounce**: Paste operations are debounced by `PASTE_DEBOUNCE_MS` (default 30ms) to handle rapid input events.

## Potential Improvements
- **Configurable Input Threshold**: Make the 200-character threshold for input compression configurable.
- **Token-based Input Compression**: Instead of character count, use token count for input compression to be more accurate with AI limits.
- **Visual Feedback**: Provide a way for users to "peek" at the content of a `[LongText#ID]` placeholder without expanding it in the input field.
- **Selective Compression**: Allow users to mark certain messages as "important" so they are never compressed.
