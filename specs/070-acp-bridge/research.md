# Research: ACP Bridge Implementation

## Decision: Implementation Strategy for ACP Bridge

The ACP bridge will be implemented as a separate entry point in `packages/code`. It will use the `@agentclientprotocol/sdk` to handle JSON-RPC communication over `stdin`/`stdout` and bridge it to the `WaveAgent` SDK.

### Rationale
- **Standard Protocol**: Using ACP ensures compatibility with a growing ecosystem of AI-powered IDE plugins and tools.
- **Separation of Concerns**: Keeping the bridge logic in `packages/code/src/acp/` separates it from the interactive CLI UI (Ink components).
- **SDK Integration**: The bridge will directly use `wave-agent-sdk` to manage sessions, send prompts, and handle tool permissions.

### Findings

#### 1. ACP SDK Usage
The `@agentclientprotocol/sdk` provides `AgentSideConnection` and `ndJsonStream` which simplify the implementation of an ACP-compliant agent. It handles JSON-RPC message parsing, request/response matching, and notification dispatching.

#### 2. Session Management
- **New Session**: `WaveAgent.create` will be used to create a new session in the specified `cwd`.
- **Load Session**: `WaveAgent.create` with `restoreSessionId` will be used to load an existing session.
- **List Sessions**: `listSessions` from `wave-agent-sdk` will be used to find available sessions in a directory.

#### 3. Tool Permissions
The bridge will implement the `canUseTool` callback in `WaveAgent.create`. When a tool requires permission, the bridge will send a `requestPermission` request to the client via ACP and wait for the response.

#### 4. Streaming Updates
The bridge will use the `callbacks` in `WaveAgent.create` to listen for assistant content chunks, reasoning chunks, and tool call updates. These will be forwarded to the client as `sessionUpdate` notifications.

### Alternatives Considered

#### 1. MCP (Model Context Protocol)
- **Pros**: Another standard for AI tool integration.
- **Cons**: ACP is more focused on agent-client interaction (like IDEs), while MCP is more about tool/resource discovery.
- **Decision**: ACP was chosen as the primary protocol for IDE integration, but MCP support could be added later.

#### 2. Custom WebSocket Protocol
- **Pros**: Full control over the protocol.
- **Cons**: Requires custom client implementations; doesn't benefit from the ACP ecosystem.
- **Decision**: Rejected in favor of the standard ACP protocol.

### NEEDS CLARIFICATION Resolved
- **Protocol**: Use ACP over `stdin`/`stdout`.
- **SDK**: Use `@agentclientprotocol/sdk`.
- **Session Storage**: Use the existing session storage mechanism in `wave-agent-sdk`.
