# Spec: LSP Integration Support

## Overview
LSP (Language Server Protocol) integration allows Wave to provide advanced code intelligence features to the agent, such as finding definitions, references, and hover information. This is achieved by managing LSP server processes and exposing their capabilities through a dedicated tool.

## Architecture

### LspManager
The `LspManager` is responsible for:
- Loading LSP configurations from `.lsp.json`.
- Spawning and managing LSP server child processes.
- Implementing the JSON-RPC protocol over stdio.
- Tracking opened files and sending `textDocument/didOpen` notifications.
- Providing an `execute` method to perform LSP operations.

### LspTool
The `lspTool` is a built-in tool that the agent can use to interact with the `LspManager`. It translates agent requests into LSP operations and formats the results for the agent.

## Configuration
LSP servers are configured in a `.lsp.json` file at the root of the workspace.

```json
{
  "languageId": {
    "command": "executable-name",
    "args": ["--arg1", "--arg2"],
    "env": { "VAR": "VALUE" },
    "extensionToLanguage": {
      ".ext": "languageId"
    },
    "initializationOptions": {}
  }
}
```

## Supported Operations

| Operation | LSP Method | Description |
|-----------|------------|-------------|
| `goToDefinition` | `textDocument/definition` | Finds the definition of the symbol at the given position. |
| `hover` | `textDocument/hover` | Gets hover information (types, docs) for the symbol at the given position. |
| `findReferences` | `textDocument/references` | Finds all references to the symbol at the given position. |
| `documentSymbol` | `textDocument/documentSymbol` | Lists all symbols (classes, functions, etc.) in a document. |
| `workspaceSymbol` | `workspace/symbol` | Searches for symbols across the entire workspace. |
| `goToImplementation` | `textDocument/implementation` | Finds implementations of an interface or abstract method. |
| `prepareCallHierarchy` | `textDocument/prepareCallHierarchy` | Prepares a call hierarchy for the symbol at the given position. |
| `incomingCalls` | `callHierarchy/incomingCalls` | Finds all functions that call the current function. |
| `outgoingCalls` | `callHierarchy/outgoingCalls` | Finds all functions called by the current function. |

## Implementation Details

### JSON-RPC Framing
Messages are sent and received with a `Content-Length` header:
```
Content-Length: ...\r\n
\r\n
{ "jsonrpc": "2.0", ... }
```

### File Synchronization
Before sending a request for a file, the `LspManager` ensures the file is "open" in the LSP server by sending a `textDocument/didOpen` notification if it hasn't been sent yet for that session.

### Error Handling
- If no LSP server is configured for a file extension, the tool returns an error message.
- If an LSP server fails to start or crashes, the error is logged and reported to the agent.
- Timeouts are implemented for requests to prevent the agent from hanging.
