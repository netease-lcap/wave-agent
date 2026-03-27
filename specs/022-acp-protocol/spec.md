# Spec: Agent Client Protocol (ACP) Implementation

## Overview
The Agent Client Protocol (ACP) is a standardized protocol for communication between AI agents and their clients. Wave implements this protocol to allow external clients to interact with Wave agents.

## Goals
- Standardize communication between Wave agents and clients.
- Support session management (new, load, list, close).
- Support prompt handling (text, images, resource links).
- Support tool execution and permission requests.
- Support mode transitions (e.g., exiting plan mode).

## Key Components
- **`WaveAcpAgent`**: The main class implementing the `AcpAgent` interface from `@agentclientprotocol/sdk`.
- **`WaveAgent`**: The underlying Wave agent instance from `wave-agent-sdk`.
- **`AgentSideConnection`**: The connection between the agent and the client.

## Prompt Handling
The `prompt` function in `WaveAcpAgent` handles incoming prompts from the client.
- It aggregates text content and images from prompt blocks.
- It calls `agent.sendMessage(textContent, images)` to process the prompt.
- It returns a `PromptResponse` with `stopReason: "end_turn"` or `"cancelled"`.

## Mode Transitions and Exit Plan
When the agent is in "plan" mode and calls the `ExitPlanMode` tool, the client is prompted for approval.
- If the user selects "Yes, manually approve edits" (`allow_once`), the system changes mode to `default`.
- If the user selects "Yes, auto-accept edits" (`allow_always`), the system changes mode to `acceptEdits`.

## Implementation Details
- **`packages/code/src/acp/agent.ts`**: Contains the `WaveAcpAgent` class.
- **`packages/agent-sdk/src/agent.ts`**: Contains the `WaveAgent` class.
- **`packages/agent-sdk/src/managers/permissionManager.ts`**: Handles permission checks and mode transitions.
- **`packages/agent-sdk/src/managers/planManager.ts`**: Handles plan mode transitions.
