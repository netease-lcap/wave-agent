# Feature Specification: ExitPlanMode Tool

**Feature Branch**: `051-exit-plan-mode-tool`  
**Created**: 2026-01-19  
**Status**: Draft  
**Input**: User description: "add a tool named ExitPlanMode for plan approval. must reuse `canUseTool` for confirmation"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Approve Plan via ExitPlanMode (Priority: P1)

As an agent in plan mode, I want to use the `ExitPlanMode` tool after I have finished writing my plan to the specified plan file, so that the user can review the plan content from that file and provide approval or feedback.

**Why this priority**: This is the core functionality requested. It enables the transition from planning to execution with user oversight based on the actual plan file content.

**Independent Test**: Can be tested by putting the agent in plan mode, writing a plan to a file, calling `ExitPlanMode`, and verifying that the user sees the plan file content and is prompted for confirmation.

**Acceptance Scenarios**:

1. **Given** the agent is in plan mode and has written a plan to the designated file, **When** the agent calls `ExitPlanMode`, **Then** the user is shown the contents of the plan file and prompted to confirm via the standard `canUseTool` mechanism with three options.
2. **Given** the user is reviewing the plan from the file, **When** the user selects "Default", **Then** the tool succeeds and the agent exits plan mode into the default execution state.
3. **Given** the user is reviewing the plan from the file, **When** the user selects "Accept Edits", **Then** the tool succeeds and the agent exits plan mode into a state where subsequent edits are automatically accepted.
4. **Given** the user is reviewing the plan from the file, **When** the user chooses to "Tell agent what to do", **Then** the user provides feedback, the tool returns this feedback to the agent, and the agent remains in plan mode to refine the plan.

---

### Edge Cases

- **What happens when `ExitPlanMode` is called outside of plan mode?** The tool MUST NOT be available in the toolset when the agent is not in plan mode. If somehow invoked, it should return an error.
- **How does the system handle multiple calls to `ExitPlanMode`?** If already exiting or if the first call is pending, subsequent calls should be handled gracefully (e.g., ignored or returned as pending).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a tool named `ExitPlanMode`.
- **FR-001.1**: The tool description MUST include: "Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval."
- **FR-001.2**: The tool documentation MUST explain that the agent should have already written the plan to the file specified in the system message, and that the tool does not take plan content as a parameter.
- **FR-002**: `ExitPlanMode` tool MUST trigger a confirmation request to the user that offers three specific choices:
    - **Option 1: Default**: Exit plan mode and proceed with standard execution.
    - **Option 2: Accept Edits**: Exit plan mode and proceed in a mode where edits are automatically accepted.
    - **Option 3: Feedback**: Provide instructions/feedback to the agent and remain in plan mode.
- **FR-003**: The confirmation request MUST reuse the existing `canUseTool` mechanism, extending it if necessary to support these three specific response types.
- **FR-003.1**: The system MUST display the contents of the plan file to the user by injecting it into the `ToolBlock` via the `planContent` field, ensuring it is rendered in the message list and not passed as a tool parameter to save tokens.
- **FR-003.2**: The `ToolContext` MUST include the `toolCallId` to allow tools to update their specific UI blocks accurately.
- **FR-004**: Upon user selection of "Default" or "Accept Edits", the system MUST transition the agent out of "plan mode" into the respective target mode.
- **FR-005**: Upon user selection of "Feedback", the agent MUST remain in "plan mode" and receive the user's input as the tool's output.
- **FR-006**: `ExitPlanMode` MUST ONLY be included in the available tools list when the agent is in "plan mode".
- **FR-007**: If the agent is NOT in "plan mode", the `ExitPlanMode` tool MUST NOT be exposed to the LLM.
- **FR-008**: `ExitPlanMode` MUST NOT be available when `permissionMode` is set to `bypassPermissions`.

### Key Entities *(include if feature involves data)*

- **Plan Mode State**: A state within the agent's lifecycle where it is generating or proposing a sequence of actions.
- **ExitPlanMode Tool**: The specific tool used to transition out of the Plan Mode State.
