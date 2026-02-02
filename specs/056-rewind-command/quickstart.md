# Quickstart: Rewind Command

## Overview
The `/rewind` command allows you to roll back the agent's state to a previous user message. This is useful if the agent made a mistake or if you want to try a different approach.

## How to use

1. **Invoke the command**: Type `/rewind` in the chat.
2. **Select a checkpoint**: Use the arrow keys to select a previous user message from the list.
3. **Confirm**: Press Enter to confirm the rewind.
4. **Result**: 
    - The selected message and all subsequent messages will be removed from the chat history.
    - Any files created, modified, or deleted by the agent in those turns will be restored to their previous state.

## Example

```text
User: Create a file named hello.ts
Agent: [Creates hello.ts]
User: Now add a console log to it.
Agent: [Adds console log]
User: /rewind
[UI shows:]
> Now add a console log to it.
  Create a file named hello.ts
[User selects "Now add a console log to it."]
Agent: Rewound to "Now add a console log to it.". 1 file reverted.
```

In this example, the second turn is undone. `hello.ts` will still exist but without the console log.

## Important Notes
- **External Changes**: If you manually edited a file after the agent changed it, `/rewind` will overwrite your changes to restore the file to the agent's previous state.
- **Sequential Reversion**: Changes are undone in the exact reverse order they were made.
