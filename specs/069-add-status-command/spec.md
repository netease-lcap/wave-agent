# Feature Specification: Status Command

**Feature Branch**: `069-add-status-command`  
**Created**: 2026-02-27  
**Input**: User description: "add /status to show sth like:   Version: 2.1.62
  Session ID: 083e4351-f98e-4ee2-afce-ec9b689473e3
  cwd: /home/liuyiqi/personal-projects/wave-agent
  Wave base URL: https://aigw.netease.com
  Model: xxx

  Esc to cancel"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Agent Status (Priority: P1)

As a user, I want to quickly see the current configuration and session details of the agent so that I can verify the environment I am working in.

**Why this priority**: This is the core functionality requested. It provides transparency into the agent's state and helps in troubleshooting or verifying settings.

**Independent Test**: Can be fully tested by typing `/status` in the CLI and verifying that the displayed information (Version, Session ID, cwd, Wave base URL, Model) is accurate and formatted correctly.

**Acceptance Scenarios**:

1. **Given** the agent is in an interactive state, **When** the user types `/status`, **Then** the agent displays a status overlay containing the version, session ID, current working directory, Wave base URL, and current model, and the input box is hidden.
2. **Given** the status information is displayed, **When** the user presses `Esc`, **Then** the status display is dismissed, the input box is restored, and the user returns to the previous interactive state.

---

### Edge Cases

- **Missing Information**: If certain metadata (like the model name) is not yet initialized or available, the system should display a placeholder (e.g., "Unknown" or "Not set") rather than crashing or showing blank space.
- **Long Paths**: If the current working directory path is extremely long, the display should handle it gracefully (e.g., by wrapping or truncating with an ellipsis) to avoid breaking the UI layout.
- **Rapid Invocation**: If the user types `/status` multiple times rapidly, the system should handle it without creating multiple overlapping status views.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST recognize the `/status` command in the interactive CLI.
- **FR-002**: System MUST display the current version of the agent software.
- **FR-003**: System MUST display the unique Session ID associated with the current execution.
- **FR-004**: System MUST display the absolute path of the current working directory (cwd).
- **FR-005**: System MUST display the Wave base URL configured for the agent.
- **FR-006**: System MUST display the name of the AI model currently active in the session.
- **FR-007**: System MUST display a hint "Esc to cancel" to inform the user how to dismiss the view.
- **FR-008**: System MUST dismiss the status view and return to the previous state when the `Esc` key is pressed.
- **FR-009**: System MUST hide the input box when the status view is active.

### Key Entities

- **Session Metadata**: A collection of attributes describing the current state and configuration of the agent (Version, Session ID, CWD, Base URL, Model).
