# Feature Specification: Status Line Component Refactoring

**Feature Branch**: `030-status-line`
**Created**: 2026-03-31
**Updated**: 2026-06-01

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consistent Status Display (Priority: P1)

As a developer, I want the status line logic to be encapsulated in its own component, so that `InputBox.tsx` is easier to maintain and the status line can be reused or modified independently.

**Why this priority**: This is the core goal of the refactoring. It improves code quality and maintainability.

**Independent Test**: Can be tested by running the CLI and verifying that the status line (Mode and Shell status) is still displayed correctly at the bottom of the input area.

**Acceptance Scenarios**:

1. **Given** the CLI is running, **When** the user is in normal mode, **Then** the status line shows "Mode: [current mode] (Shift+Tab to cycle)".
2. **Given** the CLI is running, **When** the user types `!`, **Then** the status line shows "Shell: Run shell command".
3. **Given** the CLI is running, **When** the user cycles modes with Shift+Tab, **Then** the `permissionMode` in the status line updates and changes color accordingly.
4. **Given** the CLI is running, **When** the user is in BTW mode, **Then** the status line shows "Mode: BTW (ESC to dismiss)".

### User Story 2 - Context Usage Percentage (Priority: P1)

As a user, I want to see how much of the context window has been consumed, so that I can anticipate when auto-compaction will trigger and manage long conversations effectively.

**Why this priority**: Without context visibility, users have no indication that the conversation is approaching the compaction threshold, leading to unexpected context loss.

**Independent Test**: Send multiple messages and verify the percentage appears and changes color as context usage increases.

**Acceptance Scenarios**:

1. **Given** the CLI is running and no AI response has been received, **When** the status line is displayed, **Then** no percentage is shown (0 tokens consumed).
2. **Given** an AI response has been received, **When** the status line is displayed, **Then** it shows "X% context" right-aligned in gray when usage is below 80%.
3. **Given** context usage exceeds 80%, **When** the status line is displayed, **Then** the percentage text turns yellow.
4. **Given** context usage exceeds 95%, **When** the status line is displayed, **Then** the percentage text turns red.
5. **Given** AI is thinking, **When** the loading indicator is shown, **Then** the token count displays as "1,234 tokens (42%)" with color-coded percentage.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST have a dedicated `StatusLine` component in `packages/code/src/components/StatusLine.tsx`.
- **FR-002**: `StatusLine` component MUST accept `permissionMode` (string), `isShellCommand` (boolean), and `isBtwActive` (boolean) as props.
- **FR-003**: `StatusLine` component MUST prioritize displaying BTW mode when `isBtwActive` is true.
- **FR-004**: `InputBox.tsx` MUST use the `StatusLine` component instead of inline rendering logic.
- **FR-005**: `StatusLine` component MUST accept `latestTotalTokens` (number) and `maxInputTokens` (number) as optional props.
- **FR-006**: `StatusLine` component MUST display a right-aligned "X% context" text when `latestTotalTokens > 0`.
- **FR-007**: `StatusLine` component MUST color the percentage: gray (<80%), yellow (80-95%), red (>95%).
- **FR-008**: `LoadingIndicator` component MUST accept `maxInputTokens` as an optional prop and display the percentage alongside the token count as "1,234 tokens (X%)".
- **FR-009**: `ChatContextType` MUST expose `maxInputTokens` (number) derived from `Agent.getMaxInputTokens()`.
- **FR-010**: The percentage calculation MUST use `Math.min(Math.round((latestTotalTokens / maxInputTokens) * 100), 100)`, capped at 100%.

### Key Entities *(include if feature involves data)*

- **StatusLineProps**: The interface defining the properties passed to the `StatusLine` component.
- **LoadingIndicatorProps**: The interface defining the properties passed to the `LoadingIndicator` component (extended with `maxInputTokens`).
