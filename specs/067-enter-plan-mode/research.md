# Research: Enter Plan Mode

## Decision: Implementation of `EnterPlanMode` Tool

### What was chosen
- **Tool Name**: `EnterPlanMode`
- **Location**: `packages/agent-sdk/src/tools/enterPlanMode.ts`
- **Registration**: Added to `ToolManager.ts` and `constants/tools.ts`.
- **Mechanism**: The tool will call `context.permissionManager.updateConfiguredDefaultMode('plan')`.
- **User Confirmation**: Leverages the existing `canUseToolCallback` mechanism in `packages/code` which prompts the user for approval when a tool is called.

### Rationale
- **Leverage Existing Infrastructure**: The system already has a `plan` mode in `PermissionMode` and logic in `Agent.ts` to handle transitions (generating plan files, updating system prompts).
- **Consistency**: Using the existing `PermissionManager` ensures that the agent's behavior in plan mode (read-only except for the plan file) is consistently enforced.
- **User Control**: By making it a tool call, we automatically hook into the existing permission check system, giving the user the "Allow/Deny" choice.

### Alternatives considered
- **Manual State Change**: Directly modifying the agent's state without a tool call. *Rejected* because it bypasses the user's ability to approve the transition and doesn't provide a clear "action" for the agent to take.
- **New Mode Type**: Creating a separate "design" mode. *Rejected* because the existing `plan` mode already provides the necessary restrictions and behavior.

## Decision: Tool Documentation and Guidelines

### What was chosen
- The tool's `description` and `prompt` (instructions to the agent) will be based on the content of `enter-plan.tmp.js`.
- It will explicitly list "When to Use" and "When NOT to Use" criteria.

### Rationale
- **Agent Guidance**: Providing clear criteria helps the agent decide when it's appropriate to interrupt the user for a planning phase, improving the overall user experience.
- **Alignment**: Ensures the agent understands that planning is preferred for non-trivial tasks.

## Decision: Plan File Reuse and System Reminder

### What was chosen
- **Reuse Logic**: `EnterPlanMode` will check if a plan file already exists for the current session. If so, it will reuse that file path instead of generating a new one.
- **System Reminder**: Upon re-entry, a specific system reminder (as defined in the user request) will be injected into the messages to guide the agent on how to handle the existing plan.

### Rationale
- **Continuity**: Allows the agent to pick up where it left off if the user returns to the same task.
- **Agent Autonomy**: The system reminder empowers the agent to decide whether to overwrite or refine, rather than forcing a blank slate.
