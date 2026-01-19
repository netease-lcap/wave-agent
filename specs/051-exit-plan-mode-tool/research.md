# Research: ExitPlanMode Tool Implementation

## Decision: Tool Implementation and State Transition

### Rationale
The `ExitPlanMode` tool will be a built-in tool in `agent-sdk`. It will interact with `PermissionManager` to get the plan file path and trigger a confirmation request.

### Findings

#### 1. `canUseTool` and `PermissionDecision`
- **Current State**: `PermissionDecision` in `agent-sdk/src/types/permissions.ts` already supports `newPermissionMode: PermissionMode`. `PermissionMode` includes `acceptEdits`.
- **Proposed Change**:
    - `Default` -> `{ behavior: 'allow', newPermissionMode: 'default' }`
    - `Accept Edits` -> `{ behavior: 'allow', newPermissionMode: 'acceptEdits' }`
    - `Feedback` -> `{ behavior: 'deny', message: 'user feedback...' }`
- **UI Integration**: `packages/code/src/components/Confirmation.tsx` already handles `newPermissionMode: "acceptEdits"` for the "auto" option. However, for `ExitPlanMode`, we need to explicitly present these three options and ensure the plan file content is displayed.

#### 2. Plan Mode Tracking
- **Current State**: `Agent` class manages `permissionMode` ('default' | 'plan' | 'acceptEdits' | 'bypassPermissions').
- **Proposed Change**: No changes to `PermissionMode` are needed as `acceptEdits` already exists.

#### 3. Tool Visibility
- **Current State**: `ToolManager.getToolsConfig()` returns all registered tools.
- **Proposed Change**: Modify `ToolManager.getToolsConfig()` (or `Agent.getModelConfig()` which calls it) to filter out `ExitPlanMode` if the current mode is not `plan`.

#### 4. Plan File Access
- **Current State**: `PermissionManager` stores `planFilePath`.
- **Proposed Change**: `ExitPlanMode` tool will use `permissionManager.getPlanFilePath()` to read the content.

### Alternatives Considered
- **Alternative**: Pass plan content as a parameter to `ExitPlanMode`.
    - **Rejected**: The requirement explicitly states the tool should read from the file and not take content as a parameter.
- **Alternative**: Use a separate tool for each option.
    - **Rejected**: The requirement specifies a single tool `ExitPlanMode` with 3 options in the confirmation.

## Technical Details

### `agent-sdk` Changes
- Implement `ExitPlanMode` tool in `packages/agent-sdk/src/tools/exitPlanMode.ts`.
- Update `ToolManager` to handle `ExitPlanMode` visibility based on `permissionMode`.
- Update `Agent` to register the new tool.

### `code` Changes
- Update `Confirmation.tsx` to handle the 3-option prompt specifically for `ExitPlanMode`.
- Ensure `Confirmation` displays the plan file content when `toolName === 'ExitPlanMode'`.
