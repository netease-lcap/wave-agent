# Research: AI Error Handling

## Current Implementation
The current implementation of AI error handling for truncated responses is located in `packages/agent-sdk/src/managers/aiManager.ts`.
When the `finish_reason` is `"length"`, the system logs a warning and, if no tools were called, adds an error block with a static message.

## Proposed Change
The proposed change is to replace the static error block with an automatic continuation mechanism.
This involves:
1. Detecting the truncation.
2. Adding a user message to prompt the AI to continue.
3. Automatically recursing the `sendAIMessage` call.

## Considerations
- **Recursion Depth**: The system already has a `recursionDepth` parameter in `sendAIMessage`. This should be incremented for each recursive call, whether triggered by tool calls or truncation.
- **Tool Calls**: If tools were called, the tool results themselves serve as a reminder for the AI to continue. Adding an extra user message in this case might be redundant or confusing.
- **User Control**: The system must still respect abort signals and backgrounded tools to ensure the user remains in control.
