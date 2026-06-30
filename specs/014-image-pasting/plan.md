# Implementation Plan: Image Pasting

This document outlines the implementation plan for the image pasting feature.

## Phase 1: Clipboard Image Reading

1.  **Implement `readClipboardImage`**: Create a utility function in `packages/code/src/utils/clipboard.ts` to read images from the clipboard on macOS, Windows, and Linux.
2.  **Implement `hasClipboardImage`**: Create a utility function to check if the clipboard contains an image without saving it to a file.
3.  **Implement `cleanupTempImage`**: Create a utility function to delete temporary image files.

## Phase 2: Input Manager Integration

1.  **Update `InputState`**: Add `attachedImages` and `imageIdCounter` to the `InputState` in `packages/code/src/managers/inputReducer.ts`.
2.  **Update `InputAction`**: Add `ADD_IMAGE`, `REMOVE_IMAGE`, `CLEAR_IMAGES`, and `ADD_IMAGE_AND_INSERT_PLACEHOLDER` actions to the `InputAction` type.
3.  **Update `inputReducer`**: Implement the logic for the new actions in the `inputReducer`.
4.  **Implement `handlePasteImage`**: Create a handler in `packages/code/src/managers/inputHandlers.ts` to call `readClipboardImage` and dispatch the `ADD_IMAGE_AND_INSERT_PLACEHOLDER` action.
5.  **Update `handleNormalInput`**: Add a check for `Ctrl+V` to trigger `handlePasteImage`.
6.  **Update `handleSubmit`**: Parse the input text for image placeholders and include the referenced images in the `onSendMessage` callback.

## Phase 3: UI Integration

1.  **Update `InputBox`**: Use the `attachedImages` and `handlePasteImage` from the `useInputManager` hook.
2.  **Display Attached Images**: (Optional) Add a UI component to display the list of attached images in the `InputBox`.
3.  **Handle Image Deletion**: (Optional) Add a way for users to remove attached images from the list.

## Phase 4: AI Service Integration

1.  **Update `convertMessagesForAPI`**: Ensure that the `images` field in the message payload is correctly converted into the format required by the AI provider (e.g., OpenAI, Anthropic).
2.  **Test with AI Providers**: Verify that images are correctly sent and processed by the AI.

## Phase 5: Testing and Cleanup

1.  **Unit Tests**: Write unit tests for `readClipboardImage`, `inputReducer`, and `inputHandlers`.
2.  **Integration Tests**: Verify the end-to-end flow of pasting an image and sending a message.
3.  **Cleanup**: Ensure that temporary image files are correctly deleted after use.
