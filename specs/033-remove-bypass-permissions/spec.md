# Feature Specification: Remove Bypass Permissions from Shift+Tab

**Feature Branch**: `033-remove-bypass-permissions`  
**Created**: 2025-12-26  
**Status**: Implemented  
**Input**: User description: "remove bypass permissions from shift tab"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cycle between Default and Accept Edits (Priority: P1)

As a user, I want to quickly toggle between "Default" and "Accept Edits" permission modes using a keyboard shortcut so that I can control how the agent interacts with my files without accidentally enabling full bypass mode.

**Why this priority**: This is the core requirement. It ensures the most common and safe permission modes are easily accessible while removing the risk of accidentally entering bypass mode.

**Independent Test**: Can be tested by pressing `Shift+Tab` multiple times and observing that the mode only toggles between "Default" and "Accept Edits".

**Acceptance Scenarios**:

1. **Given** the agent is in "Default" permission mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to "Accept Edits".
2. **Given** the agent is in "Accept Edits" permission mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to "Default".

---

### User Story 2 - Handle Bypass Mode Transition (Priority: P2)

As a user, if the agent is currently in "Bypass Permissions" mode (e.g., set via configuration), I want `Shift+Tab` to bring me back into the safe cycle of "Default" and "Accept Edits".

**Why this priority**: Ensures consistent behavior even if the system starts in or enters a state that is no longer part of the shortcut cycle.

**Independent Test**: Can be tested by manually setting the mode to "Bypass Permissions" (if possible via other means) and then pressing `Shift+Tab` to see it return to "Default".

**Acceptance Scenarios**:

1. **Given** the agent is in "Bypass Permissions" mode, **When** the user presses `Shift+Tab`, **Then** the permission mode changes to "Default".

---

### Edge Cases

- **What happens when the user presses Shift+Tab repeatedly?** The system should continuously cycle between "Default" and "Accept Edits" (Default -> Accept Edits -> Default -> Accept Edits...).
- **How does the system handle the shortcut if only one mode is available?** (Not applicable here as there are at least two modes, but good to consider).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `Shift+Tab` keyboard shortcut MUST cycle the agent's permission mode.
- **FR-002**: The cycle triggered by `Shift+Tab` MUST only include "Default" and "Accept Edits" modes.
- **FR-003**: The "Bypass Permissions" mode MUST be removed from the `Shift+Tab` cycling sequence.
- **FR-004**: If the system is in a mode not included in the cycle (like "Bypass Permissions"), pressing `Shift+Tab` MUST transition the system to the first mode in the cycle ("Default").

### Key Entities *(include if feature involves data)*

- **Permission Mode**: A state that determines the level of authorization required for the agent to perform restricted actions.
  - **Default**: Requires explicit permission for restricted tools.
  - **Accept Edits**: Automatically accepts file modifications but may require permission for other actions.
  - **Bypass Permissions**: (Removed from shortcut) Allows all actions without prompting.
