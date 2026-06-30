# Tasks: Image Pasting

This document lists the tasks for the image pasting feature.

## Phase 1: Clipboard Image Reading

- [x] Implement `readClipboardImage` in `packages/code/src/utils/clipboard.ts`.
- [x] Implement `hasClipboardImage` in `packages/code/src/utils/clipboard.ts`.
- [x] Implement `cleanupTempImage` in `packages/code/src/utils/clipboard.ts`.

## Phase 2: Input Manager Integration

- [x] Update `InputState` in `packages/code/src/managers/inputReducer.ts`.
- [x] Update `InputAction` in `packages/code/src/managers/inputReducer.ts`.
- [x] Update `inputReducer` in `packages/code/src/managers/inputReducer.ts`.
- [x] Implement `handlePasteImage` in `packages/code/src/managers/inputHandlers.ts`.
- [x] Update `handleNormalInput` in `packages/code/src/managers/inputHandlers.ts`.
- [x] Update `handleSubmit` in `packages/code/src/managers/inputHandlers.ts`.

## Phase 3: UI Integration

- [x] Update `InputBox` in `packages/code/src/components/InputBox.tsx`.
- [ ] Display Attached Images in the `InputBox`.
- [ ] Handle Image Deletion in the `InputBox`.

## Phase 4: AI Service Integration

- [x] Update `convertMessagesForAPI` in `packages/agent-sdk/src/utils/convertMessagesForAPI.ts`.
- [x] Test with AI Providers.

## Phase 5: Testing and Cleanup

- [x] Write unit tests for `readClipboardImage`.
- [x] Write unit tests for `inputReducer`.
- [x] Write unit tests for `inputHandlers`.
- [ ] Verify the end-to-end flow of pasting an image and sending a message.
- [ ] Ensure that temporary image files are correctly deleted after use.
