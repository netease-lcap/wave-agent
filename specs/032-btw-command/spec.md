# BTW Command Spec

The `/btw <question>` command allows users to ask side questions to the AI without using tools. The answer is displayed in a special component at the bottom of the chat interface, and the main input box is disabled while the side question is active. A key feature of this command is that it bypasses the main message queue, allowing it to be processed immediately even if the AI is busy with another task.

## Goals

- Provide a way to ask quick questions without triggering tool executions.
- Keep the side question context separate from the main conversation flow.
- Allow users to dismiss the side question view easily.
- Ensure side questions are processed immediately, bypassing the main message queue.
- Prevent side questions from being added to the main chat history or user input history.

## User Experience

1. User types `/btw <question>` and presses Enter, or just types `/btw` and presses Enter to enter "BTW mode".
2. The main input box shows a cyan border and "Type your side question..." placeholder in cyan if empty. A cursor is displayed before the placeholder.
3. The status line shows `Mode: BTW (ESC to dismiss)` where "BTW" is in cyan.
4. A `BtwDisplay` component appears above the task list and loading indicator.
5. The `BtwDisplay` shows a status dot (yellow when loading, green when finished) followed by the question as `/btw <question>` in italic gray.
6. Once the AI responds, the answer is displayed in the `BtwDisplay`.
7. The user can press **ESC** to dismiss the `BtwDisplay` and return to the main conversation mode.

## Implementation Details

### Agent SDK

- **`AiService`**: Added `btw` method that uses a specialized system prompt (`BTW_SYSTEM_PROMPT`) to prevent tool calling.
- **`Agent`**: Added `askBtw` method to call the AI service.

### Code Package

- **`inputReducer`**: Added `btwState` to track `isActive`, `question`, `answer`, and `isLoading`.
- **`inputHandlers`**: Intercepts `/btw` command and handles the **ESC** key to dismiss the side question.
- **`useInputManager`**: Manages the lifecycle of the side question and calls the `onAskBtw` callback.
- **`useChat`**: Provides the `askBtw` implementation and manages the `btwState` in the chat context.
- **`BtwDisplay`**: A compact Ink component to render the side question and answer. It displays the question as `/btw <question>` in italic gray.
- **`InputBox`**: Updated to show a cyan border and a cursor before the placeholder text when `btwState.isActive` is true.
- **`StatusLine`**: Updated to prioritize displaying `Mode: BTW (ESC to dismiss)` when `btwState.isActive` is true.
