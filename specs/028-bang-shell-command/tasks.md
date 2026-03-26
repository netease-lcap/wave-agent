# Tasks: Bang Shell Command

## Phase 1: Core Implementation (Priority: P1)

- [x] **Task 1: Implement `BangManager`**
    - [x] Create `BangManager` class in `packages/agent-sdk/src/managers/bangManager.ts`.
    - [x] Implement `executeCommand` method using `child_process.spawn`.
    - [x] Implement `abortCommand` method to kill the running process.
    - [x] Add unit tests for `BangManager` in `packages/agent-sdk/tests/managers/bangManager.test.ts`.

- [x] **Task 2: Implement `BangDisplay` Component**
    - [x] Create `BangDisplay` component in `packages/code/src/components/BangDisplay.tsx`.
    - [x] Implement output truncation logic (max 3 lines).
    - [x] Add visual cues for running, success, and failure states.
    - [x] Add unit tests for `BangDisplay` in `packages/code/tests/components/BangDisplay.test.tsx`.

## Phase 2: Integration (Priority: P2)

- [x] **Task 3: Integrate `BangManager` with `InputManager`**
    - [x] Detect `!` prefix in chat input.
    - [x] Call `BangManager.executeCommand` when a bang command is entered.
    - [x] Handle command abort (e.g., Ctrl+C).
    - [x] Update `isCommandRunning` state in `useChat` context to ensure UI updates correctly.

- [x] **Task 4: Update `MessageManager` to support `BangBlock`**
    - [x] Add `BangBlock` type to `packages/agent-sdk/src/types/messaging.ts`.
    - [x] Implement `addBangMessage`, `updateBangMessage`, and `completeBangMessage` methods.

## Phase 3: UI Enhancements (Priority: P3)

- [x] **Task 5: Add Expand/Collapse functionality to `BangDisplay`**
    - [x] Implement a way for users to toggle the expansion of the output block (via global `isExpanded` state).
    - [x] Ensure the UI remains responsive during long-running commands.
