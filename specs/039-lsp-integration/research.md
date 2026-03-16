# Research: LSP Integration Support

**Decision**: Implement a custom `LspManager` for server lifecycle and a dedicated `lsp` tool for agent interaction.

**Rationale**: 
- LSP provides standardized code intelligence that is far superior to simple regex-based searching.
- Managing servers within the agent's lifecycle ensures they are cleaned up properly.
- A tool-based approach allows the agent to use code intelligence intentionally when needed.

**Alternatives Considered**:
- **Existing LSP Client Libraries**: Rejected to keep dependencies minimal and maintain full control over the communication layer.
- **Persistent Background Servers**: Rejected to avoid orphaned processes; lifecycle management within the agent is safer.
- **Automatic LSP Requests**: Rejected due to performance overhead; tool-based is more efficient.

## Findings

### Server Management
- Servers are spawned as child processes using `stdio` for communication.
- `LspManager` tracks running processes by language ID.
- Lazy loading: Servers start only when a file of that language is first accessed.

### Communication
- JSON-RPC 2.0 over stdio with `Content-Length` framing.
- `textDocument/didOpen` must be sent before any requests for a specific file.
- URI to file path conversion is necessary as LSP uses URIs (e.g., `file:///path/to/file`).

### Supported Operations
- **Navigation**: `goToDefinition`, `findReferences`, `goToImplementation`.
- **Inspection**: `hover`, `documentSymbol`, `workspaceSymbol`.
- **Hierarchy**: `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`.

### Integration Points
- **Agent**: Owns the `LspManager` instance and handles initialization/cleanup.
- **ToolManager**: Injects `LspManager` into the `lsp` tool.
- **Configuration**: Loaded from `.lsp.json` in the workspace root.
