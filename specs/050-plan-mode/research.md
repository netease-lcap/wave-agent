# Research: Support Plan Mode

## Decision: System Prompt Modification
**Rationale**: The system prompt is constructed in `AIManager.ts` and passed to `callAgent`. By modifying `AIManager.sendAIMessage`, we can dynamically append the Plan Mode reminder when the current permission mode is `plan`.

## Decision: Permission Mode Enforcement
**Rationale**: `PermissionManager.ts` already handles `default` and `acceptEdits` modes. Adding a `plan` mode here allows us to centralize the authorization logic. In `plan` mode:
- `Read`, `LS`, `Glob`, `Grep` are allowed.
- `Edit`, `Write` are allowed ONLY for the designated plan file.
- `Delete` is denied (even for the plan file, to ensure it's built incrementally).
- `Bash` and other restricted tools are denied.

## Decision: Plan File Management
**Rationale**: A new `PlanManager` in `agent-sdk` will handle the creation of the `~/.wave/plans` directory and the generation of plan files. This keeps the logic separate from the UI (`InputManager`). The plan file name is deterministic within a session chain, using the `rootSessionId` as a seed.

## Decision: Deterministic Name Generator
**Rationale**: A new utility `packages/agent-sdk/src/utils/nameGenerator.ts` will be implemented using a list of adjectives and nouns. It supports seeded generation to ensure the same name is returned for the same `rootSessionId`, providing stability across message compressions.

---

## Decision: ExitPlanMode Tool Implementation
**Rationale**: The `ExitPlanMode` tool will be a built-in tool in `agent-sdk`. It will interact with `PermissionManager` to get the plan file path and trigger a confirmation request.

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

## Alternatives Considered
- **Enforcing read-only in each tool**: Too fragmented and error-prone. Centralizing in `PermissionManager` is cleaner.
- **Putting plan file in the project directory**: The requirement specifically asks for `~/.wave/plans`.
