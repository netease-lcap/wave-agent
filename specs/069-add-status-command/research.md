# Research: Status Command Implementation

## Decision: Implementation Strategy for /status

The `/status` command will be implemented as a local CLI command in `packages/code`. It will trigger a React Ink overlay component that displays session metadata retrieved from the `Agent` instance via `ChatContext`.

### Rationale
- **Local Command**: Implementing it as a local command (handled in `InputManager.ts`) ensures it works even if the AI is busy or offline, and provides instant feedback.
- **Overlay UI**: Using an overlay (similar to `HelpView`) provides a clean, non-intrusive way to view status without cluttering the chat history. The input box will be hidden when the status view is active to focus the user's attention.
- **Context Integration**: Exposing status data through `ChatContext` follows the existing pattern for sharing agent state with UI components.

### Findings

#### 1. Version Retrieval
The version will be read from `packages/code/package.json`. Since we are using ESM and TypeScript, we can import it directly if configured, or use `fs` to read it at runtime. Given the build process, reading it from `package.json` at the root of the `code` package is most reliable.

#### 2. Session Metadata
- **Session ID**: Available via `agent.sessionId`.
- **CWD**: Available via `agent.workingDirectory`.
- **Base URL**: Available via `agent.getGatewayConfig().baseURL`.
- **Model**: Available via `agent.getModelConfig().agentModel`.

#### 3. UI Implementation
- **Component**: `StatusCommand.tsx` in `packages/code/src/components`.
- **Template**: `HelpView.tsx` or `BackgroundTaskManager.tsx`.
- **Styling**: Use `Box` with `borderStyle="round"`, `borderLeft={false}`, `borderRight={false}` as per constitution/memory.
- **Dismissal**: Use `useInput` hook to listen for `Escape` key.

### Alternatives Considered

#### 1. Agent-side Slash Command
- **Pros**: Could be implemented once in `agent-sdk` and work across different frontends.
- **Cons**: Would add a message to the chat history (unless specially handled), and might be slower as it goes through the agent's command dispatcher.
- **Decision**: Rejected in favor of local CLI command for better UX and "instant" feel.

#### 2. Persistent Status Bar
- **Pros**: Always visible.
- **Cons**: Takes up vertical space in the terminal, which is limited.
- **Decision**: Rejected as the user specifically asked for a `/status` command.

## NEEDS CLARIFICATION Resolved
- **Version**: Use `packages/code/package.json`.
- **Metadata Source**: All data is accessible from the `Agent` instance.
- **UI Pattern**: Use the existing overlay pattern.
