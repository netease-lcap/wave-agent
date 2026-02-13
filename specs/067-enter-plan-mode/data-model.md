# Data Model: Enter Plan Mode

## Entities

### Plan Mode State
- **Description**: A state within the `PermissionManager` that restricts the agent's capabilities.
- **Attributes**:
    - `mode`: Set to `"plan"`.
    - `planFilePath`: The absolute path to the temporary markdown file where the plan is stored (managed by `PlanManager`).
- **Validation Rules**:
    - When in `plan` mode, the agent MUST NOT be allowed to edit any files except the one specified in `planFilePath`.
    - The agent MUST NOT be allowed to execute arbitrary bash commands that could modify the system state (enforced by `PermissionManager`).

### User Confirmation
- **Description**: The result of the user's interaction with the CLI prompt when `EnterPlanMode` is called.
- **Attributes**:
    - `approved`: Boolean indicating if the user allowed the tool execution.
- **State Transitions**:
    - `Pending` -> `Approved`: Agent transitions to `plan` mode.
    - `Pending` -> `Denied`: Agent remains in current mode; tool returns an error/rejection message.
