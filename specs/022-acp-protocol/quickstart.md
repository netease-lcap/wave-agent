# Quickstart: ACP Protocol

## Overview
The Agent Client Protocol (ACP) allows external clients to interact with Wave agents.

## Usage
1. **Initialize**: Call `initialize` to get agent capabilities.
2. **New Session**: Call `newSession` with a working directory to create a new Wave agent session.
3. **Prompt**: Call `prompt` with text or images to send a message to the agent.
4. **Tool Execution**: The agent will call tools and request permissions via the client.
5. **Mode Transitions**: The agent can transition between modes (e.g., `plan` to `default` or `acceptEdits`).

## Example: Exiting Plan Mode
1. The agent calls `ExitPlanMode` tool.
2. The client receives a permission request with two options:
   - "Yes, manually approve edits" (`allow_once`) -> Switches to `default` mode.
   - "Yes, auto-accept edits" (`allow_always`) -> Switches to `acceptEdits` mode.
3. The agent proceeds with implementation in the new mode.
