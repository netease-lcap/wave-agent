# BTW Command Implementation Plan

The implementation of the `/btw` command involves changes to both the `agent-sdk` and `code` packages.

## Phase 1: Agent SDK

1. Add `BTW_SYSTEM_PROMPT` to `aiService.ts`.
2. Implement `btw` method in `AiService` to call the AI without tools.
3. Add `askBtw` method to the `Agent` class.
4. Add tests for the `btw` method in `aiService.btw.test.ts`.

## Phase 2: Code Package State Management

1. Update `inputReducer.ts` to include `btwState` and `SET_BTW_STATE` action.
2. Update `inputHandlers.ts` to intercept `/btw` command in `handleSubmit`.
   - If the input starts with `/btw `, extract the question and set `btwState`.
   - Return early from `handleSubmit` to prevent the message from being added to `PromptHistoryManager` or sent via `onSendMessage`. This ensures it bypasses the `queuedMessages` logic in `useChat.tsx`.
3. Update `inputHandlers.ts` to handle the **ESC** key to dismiss the side question.
4. Update `useInputManager.ts` to manage the side question lifecycle and sync state with the chat context.
5. Update `useChat.tsx` to provide the `askBtw` implementation.
   - `askBtw` calls `agent.askBtw(question)` directly, bypassing the `sendMessage` function and its associated queue.

## Phase 3: UI Components

1. Create `BtwDisplay.tsx` to render the side question and answer.
   - Display the question as `/btw <question>` in italic gray.
   - Make the display compact by removing unnecessary headers and padding.
2. Integrate `BtwDisplay` into `ChatInterface.tsx`.
3. Update `InputBox.tsx` to show a cyan border and a cursor before the placeholder text when `btwState.isActive` is true.
4. Update `StatusLine.tsx` to prioritize displaying `Mode: BTW (ESC to dismiss)` when `btwState.isActive` is true.

## Phase 4: Testing and Verification

1. Run `pnpm test` in `agent-sdk` and `code` packages.
2. Fix any broken component tests due to state changes.
3. Verify the `/btw` command in the CLI.
