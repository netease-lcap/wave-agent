# Plan: Bang Shell Command

## Phase 1: Core Implementation (Priority: P1)

### Task 1: Implement `BangManager`

- **Objective**: Create a service to manage shell command execution.
- **Implementation**:
    - Create `packages/agent-sdk/src/managers/bangManager.ts`.
    - Use `child_process.spawn` to execute commands.
    - Capture stdout and stderr and update the message history.
    - Implement `abortCommand` to kill the running process.
- **Testing**:
    - Add unit tests in `packages/agent-sdk/tests/managers/bangManager.test.ts`.
    - Test successful execution, failure, and command abort.

### Task 2: Implement `BangDisplay` Component

- **Objective**: Create a React Ink component to display command output.
- **Implementation**:
    - Create `packages/code/src/components/BangDisplay.tsx`.
    - Implement output truncation logic (max 3 lines).
    - Use colors to indicate execution status (running, success, failure).
- **Testing**:
    - Add unit tests in `packages/code/tests/components/BangDisplay.test.tsx`.
    - Test rendering of command, output, and truncation.

## Phase 2: Integration (Priority: P2)

### Task 3: Integrate `BangManager` with `InputManager`

- **Objective**: Connect the chat input to the `BangManager`.
- **Implementation**:
    - Update `InputManager` to detect `!` prefix.
    - Call `BangManager.executeCommand` when a bang command is entered.
    - Handle command abort (e.g., Ctrl+C).
    - Update `isCommandRunning` state in `useChat` context to ensure the UI correctly identifies the command as running and prevents it from becoming static prematurely.

### Task 4: Update `MessageManager` to support `BangBlock`

- **Objective**: Add support for `BangBlock` in the message history.
- **Implementation**:
    - Add `BangBlock` type to `packages/agent-sdk/src/types/messaging.ts`.
    - Implement `addBangMessage`, `updateBangMessage`, and `completeBangMessage` methods.

## Phase 3: UI Enhancements (Priority: P3)

### Task 5: Add Expand/Collapse functionality to `BangDisplay`

- **Objective**: Allow users to toggle the expansion of the output block.
- **Implementation**:
    - Implement a way for users to toggle the expansion of the output block.
    - Ensure the UI remains responsive during long-running commands.
