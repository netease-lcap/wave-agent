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

- [ ] **Task 3: Integrate `BangManager` with `InputManager`**
    - [ ] Detect `!` prefix in chat input.
    - [ ] Call `BangManager.executeCommand` when a bang command is entered.
    - [ ] Handle command abort (e.g., Ctrl+C).

- [ ] **Task 4: Update `MessageManager` to support `BangBlock`**
    - [ ] Add `BangBlock` type to `packages/agent-sdk/src/types/messaging.ts`.
    - [ ] Implement `addBangMessage`, `updateBangMessage`, and `completeBangMessage` methods.

## Phase 3: UI Enhancements (Priority: P3)

- [ ] **Task 5: Add Expand/Collapse functionality to `BangDisplay`**
    - [ ] Implement a way for users to toggle the expansion of the output block.
    - [ ] Ensure the UI remains responsive during long-running commands.
