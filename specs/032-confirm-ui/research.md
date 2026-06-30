# Research: Confirm UI

## Decision: Two-Component Architecture
- **Rationale**: Separating `ConfirmationDetails` (display) from `ConfirmationSelector` (interaction) allows independent rendering and clean separation of concerns. The details component shows what the tool will do, while the selector handles user input.
- **Alternatives considered**:
    - Single monolithic component: Rejected because it would mix display and interaction logic, making testing and maintenance harder.

## Decision: Queue-Based Confirmation Processing
- **Rationale**: Processing confirmations one at a time prevents UI overwhelm and allows focused decision-making. The queue stores pending confirmations while `currentConfirmation` holds the active one.
- **Alternatives considered**:
    - Parallel confirmations: Rejected because displaying multiple confirmations simultaneously would confuse users and complicate keyboard navigation.

## Decision: Static Mode for Overflow
- **Rationale**: When the confirmation UI exceeds terminal height, switching to Ink's `Static` component prevents flickering and layout thrashing during re-renders.
- **Alternatives considered**:
    - Truncated display: Rejected because users need to see all relevant information to make informed decisions.

## Decision: Remount After Static Mode Exit
- **Rationale**: When exiting static mode (after all confirmations are resolved), the terminal needs to be cleared and the message list re-rendered. The `requestRemount()` function clears the screen with ANSI escape codes (`\u001b[2J\u001b[3J\u001b[0;0H`) and increments `remountKey` to force React to remount the `MessageList` component. This ensures the static content is removed and the UI returns to normal interactive mode.
- **Alternatives considered**:
    - Keep static content: Rejected because it would leave frozen content on screen after the confirmation flow ends.
    - Gradual cleanup: Rejected because it's more complex and could leave partial artifacts.

## Decision: Ref-Based Decision Dispatch
- **Rationale**: Using `pendingDecisionRef` to hold the decision and dispatching it in a `useEffect` ensures the decision is processed after React's render cycle completes, preventing state updates during render.
- **Alternatives considered**:
    - Direct call in useInput: Rejected because it could cause state updates during render phase.

## Decision: State Preservation for Multi-Question Flow
- **Rationale**: The `savedStates` object in `QuestionState` preserves selections when navigating between questions with Tab, allowing users to return to previous questions without losing their answers.
- **Alternatives considered**:
    - Immediate commit on navigation: Rejected because users might want to change previous answers before final submission.

## Decision: Suggested Prefix for Bash Commands
- **Rationale**: Analyzing the Bash command to extract a prefix (e.g., `npm` from `npm install`) provides more useful persistent rules than matching the exact command string.
- **Alternatives considered**:
    - Exact command matching: Rejected because it would require users to approve each unique command individually.

## Decision: Special Handling for mkdir Commands
- **Rationale**: `mkdir` commands are typically safe and often precede file creation, so auto-accepting edits mode is more appropriate than creating a persistent rule.
- **Alternatives considered**:
    - Standard persistent rule: Rejected because mkdir is a one-time setup operation in most cases.

## Decision: Color-Coded Headers for Questions
- **Rationale**: Using a hash function to assign colors to question headers provides visual distinction between different questions in the flow without manual configuration.
- **Alternatives considered**:
    - Fixed sequential colors: Rejected because it wouldn't scale well with varying numbers of questions.

## Integration Points
- `useChat` context: Manages confirmation state and queue.
- `ChatInterface`: Renders `ConfirmationDetails` and `ConfirmationSelector`.
- `Agent` (agent-sdk): Provides `canUseTool` callback that triggers confirmation flow.
- `PermissionManager` (agent-sdk): Calls the permission callback for restricted tools.
