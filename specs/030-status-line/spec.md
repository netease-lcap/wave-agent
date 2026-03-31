# Feature Specification: Status Line Component Refactoring

**Feature Branch**: `030-status-line`  
**Created**: 2026-03-31  
**Input**: User description: "Move the status line logic (displaying the current mode and shell command status) from `InputBox.tsx` into a dedicated `StatusLine.tsx` component for better modularity."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consistent Status Display (Priority: P1)

As a developer, I want the status line logic to be encapsulated in its own component, so that `InputBox.tsx` is easier to maintain and the status line can be reused or modified independently.

**Why this priority**: This is the core goal of the refactoring. It improves code quality and maintainability.

**Independent Test**: Can be tested by running the CLI and verifying that the status line (Mode and Shell status) is still displayed correctly at the bottom of the input area.

**Acceptance Scenarios**:

1. **Given** the CLI is running, **When** the user is in normal mode, **Then** the status line shows "Mode: [current mode] (Shift+Tab to cycle)".
2. **Given** the CLI is running, **When** the user types `!`, **Then** the status line shows "Shell: Run shell command".
3. **Given** the CLI is running, **When** the user cycles modes with Shift+Tab, **Then** the `permissionMode` in the status line updates and changes color accordingly.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST have a dedicated `StatusLine` component in `packages/code/src/components/StatusLine.tsx`.
- **FR-002**: `StatusLine` component MUST accept `permissionMode` (string) and `isShellCommand` (boolean) as props.
- **FR-003**: `StatusLine` component MUST render the same UI as previously implemented in `InputBox.tsx`.
- **FR-004**: `InputBox.tsx` MUST use the `StatusLine` component instead of inline rendering logic.

### Key Entities *(include if feature involves data)*

- **StatusLineProps**: The interface defining the properties passed to the `StatusLine` component.
