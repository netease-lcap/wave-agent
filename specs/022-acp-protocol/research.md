# Research: Agent Client Protocol (ACP) Implementation in Wave

## Overview
The Agent Client Protocol (ACP) is a standardized protocol for communication between AI agents and their clients. Wave implements this protocol to allow external clients to interact with Wave agents.

## Key Components
- **`WaveAcpAgent`**: The main class implementing the `AcpAgent` interface from `@agentclientprotocol/sdk`. Located in `packages/code/src/acp/agent.ts`.
- **`WaveAgent`**: The underlying Wave agent instance from `wave-agent-sdk`.

## Prompt Handling
The `prompt` function in `WaveAcpAgent` (lines 328-383 in `packages/code/src/acp/agent.ts`) handles incoming prompts from the client.
- It iterates through prompt blocks (text, resource links, images).
- It aggregates text content and images.
- It calls `agent.sendMessage(textContent, images)` to process the prompt.
- It returns a `PromptResponse` with `stopReason: "end_turn"` or `"cancelled"`.

## Mode Transitions and Exit Plan
When the agent is in "plan" mode and calls the `ExitPlanMode` tool, the client is prompted for approval.

### Permission Request Flow
1. `WaveAcpAgent.handlePermissionRequest` is called for `EXIT_PLAN_MODE_TOOL_NAME`.
2. It provides two options to the user:
   - "Yes, manually approve edits" (`allow_once`)
   - "Yes, auto-accept edits" (`allow_always`)
3. If the user selects "Yes, manually approve edits":
   - It returns `{ behavior: "allow", newPermissionMode: "default" }`.
4. If the user selects "Yes, auto-accept edits":
   - It returns `{ behavior: "allow", newPermissionRule: "ExitPlanMode" }`.

### Mode Change
- When `newPermissionMode: "default"` is returned, the `WaveAgent`'s permission mode is updated to `default`.
- This update triggers `planManager.handlePlanModeTransition("default")`, which effectively exits plan mode.
- Therefore, selecting the option to exit plan mode **does** change the system mode.

## Conclusion
The ACP implementation in Wave correctly handles mode transitions, specifically when exiting plan mode. The `prompt` function serves as the bridge between ACP's structured prompt format and Wave's internal message handling.
