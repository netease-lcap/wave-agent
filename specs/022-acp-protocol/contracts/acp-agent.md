# ACP Agent Contract

## Interface: `AcpAgent`
The `WaveAcpAgent` class implements the `AcpAgent` interface from `@agentclientprotocol/sdk`.

### Methods
- `initialize()`: Initializes the agent and returns capabilities.
- `authenticate()`: Handles authentication (currently no-op).
- `newSession(params)`: Creates a new Wave agent session.
- `loadSession(params)`: Loads an existing Wave agent session.
- `listSessions(params)`: Lists available Wave agent sessions.
- `prompt(params)`: Sends a prompt to the Wave agent.
- `cancel(params)`: Aborts the current AI message or command.
- `setSessionMode(params)`: Updates the agent's permission mode.
- `setSessionConfigOption(params)`: Updates session configuration options.
- `extMethod(method, params)`: Handles extended methods (e.g., `session_close`).

### Callbacks
- `onAssistantContentUpdated`: Sends `agent_message_chunk` to the client.
- `onAssistantReasoningUpdated`: Sends `agent_thought_chunk` to the client.
- `onToolBlockUpdated`: Sends `tool_call` or `tool_call_update` to the client.
- `onTasksChange`: Sends `plan` updates to the client.
- `onPermissionModeChange`: Sends `current_mode_update` to the client.
