# Research: LSP Integration Support

**Date**: 2025-12-24
**Feature**: LSP Integration Support
**Purpose**: Resolve technical implementation decisions and patterns for integrating Language Server Protocol support into Wave.

## LSP Server Management

### Decision: LspManager for Lifecycle Control
**Rationale**: Create a dedicated `LspManager` to handle the lifecycle of LSP servers, including starting, stopping, and communicating with them via JSON-RPC over stdio.

**Key Responsibilities**:
- Manage child processes for different LSP servers based on language.
- Handle JSON-RPC message framing (Content-Length headers).
- Maintain state of opened files (`textDocument/didOpen`).
- Route requests and notifications to the appropriate server.
- Implement graceful shutdown (`shutdown` request followed by `exit` notification).
- Support for `goToImplementation`.
- Automatic `prepareCallHierarchy` for call hierarchy operations.

**Alternatives Considered**:
- Using an existing LSP client library: Rejected to keep dependencies minimal and have full control over the communication layer, which is relatively simple for the required subset of LSP.
- Running LSP servers as persistent background processes: Rejected in favor of managing them within the Agent's lifecycle to ensure they are cleaned up properly.

## Communication Protocol

### Decision: JSON-RPC over Stdio
**Rationale**: Most LSP servers support stdio-based communication. It is simple to implement using Node.js `child_process.spawn` and provides a reliable transport layer.

**Implementation Details**:
- Use `Content-Length` headers for message framing.
- Implement a simple request/response mapping using unique IDs.
- Support notifications (requests without IDs).

## Agent Integration

### Decision: Dedicated `lspTool`
**Rationale**: Expose LSP capabilities to the agent through a specialized tool. This allows the agent to proactively seek code intelligence when needed.

**Supported Operations**:
- `goToDefinition`: Find where a symbol is defined.
- `hover`: Get documentation and type information.
- `findReferences`: Find all usages of a symbol.
- `documentSymbol`: List all symbols in a file.
- `workspaceSymbol`: Search for symbols across the project.
- `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`: Explore function call relationships.
- `goToImplementation`: Find implementations of an interface or abstract method.

**Alternatives Considered**:
- Automatically triggering LSP requests on every agent action: Rejected due to potential performance overhead and noise. A tool-based approach is more intentional.

## Configuration

### Decision: `.lsp.json` and `plugin.json`
**Rationale**: Allow users to configure LSP servers per project using `.lsp.json` and support plugin-provided LSP configurations.

**Configuration Structure**:
```json
{
  "typescript": {
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "extensionToLanguage": {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript"
    }
  }
}
```

## Performance and Reliability

### Decision: Lazy Loading and Cleanup
**Rationale**: Start LSP servers only when requested for a specific file type. Ensure all processes are killed when the agent shuts down.

**Strategies**:
- `getProcessForFile` triggers server start if not already running.
- `cleanup` method in `LspManager` to kill all managed processes.
- Error handling for server crashes or communication failures.
