# Test Plan: ExitPlanMode Optimization and Rendering Fix

## Objective
Verify that the `ExitPlanMode` tool correctly reads the plan file, updates the UI block with the plan content using the correct `toolCallId`, and that the UI renders this content without passing it as a tool parameter.

## Test Scenarios

### 1. Unit Test: ToolContext and AIManager Integration
- **Goal**: Ensure `toolCallId` is correctly passed from `AIManager` to the tool's `execute` method.
- **Verification**:
    - Mock `toolManager.execute` and verify it receives a `context` object containing the expected `toolCallId`.

### 2. Unit Test: ExitPlanMode Tool Logic
- **Goal**: Ensure `ExitPlanMode` uses the `toolCallId` to update the tool block.
- **Verification**:
    - Mock `context.permissionManager.updateToolBlock`.
    - Call `exitPlanModeTool.execute` with a specific `toolCallId` in the context.
    - Verify `updateToolBlock` is called with the same `id` and the correct `planContent`.

### 3. Integration Test: End-to-End Plan Mode Exit
- **Goal**: Verify the full flow from calling the tool to UI rendering (mocked).
- **Steps**:
    1. Set agent to `plan` mode.
    2. Write a dummy plan to the plan file.
    3. Call `agent.sendMessage` with a prompt that triggers `ExitPlanMode`.
    4. Verify that `messageManager.updateToolBlock` was called with the correct `id` and `planContent`.
    5. Verify that the resulting `Message` object contains a `ToolBlock` with the `planContent`.

### 4. UI Component Test: ToolResultDisplay Rendering
- **Goal**: Ensure `ToolResultDisplay` renders `planContent` when present.
- **Verification**:
    - Render `ToolResultDisplay` with a `ToolBlock` containing `planContent`.
    - Verify the output contains the "Plan Content:" header and the markdown-rendered content.

## Execution Plan
1. Run existing tests to ensure no regressions.
2. Add new unit tests in `packages/agent-sdk/tests/exitPlanMode.test.ts`.
3. Add integration test in `packages/agent-sdk/tests/agent.planMode.test.ts`.
4. Run all tests using `pnpm test`.
