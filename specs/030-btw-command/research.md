# BTW Command Research

The `/btw` command is designed to provide a way to ask side questions to the AI without using tools. This is useful for quick questions that don't require any tool execution or context from the main conversation.

## Design Considerations

- **Tool Calling**: The side question should not trigger any tool executions. This is achieved by using a specialized system prompt (`BTW_SYSTEM_PROMPT`) that instructs the AI to only provide direct answers.
- **Context**: The side question context should be kept separate from the main conversation flow. This is achieved by using a dedicated `btwState` in the chat context.
- **User Experience**: The side question view should be easily dismissible. This is achieved by handling the **ESC** key to dismiss the `BtwDisplay` and re-enable the main input box.
- **State Management**: The `btwState` should be synced between the `inputReducer` and the `ChatContext` to ensure that the UI stays in sync.
- **Queue Bypassing**: The `/btw` command should bypass the `queuedMessages` logic in `useChat.tsx`. This is achieved by calling `agent.askBtw` directly from the `askBtw` method in `useChat.tsx`, rather than going through the `sendMessage` function which handles queuing.
- **History Exclusion**: Side questions should not be added to the main chat history or the user's input history. This is achieved by intercepting the `/btw` command in `handleSubmit` and returning early before `PromptHistoryManager.addEntry` or `onSendMessage` are called.
