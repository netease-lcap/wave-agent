# Data Model: LSP Integration Support

## Entities

### LspServerConfig
Configuration for a single LSP server (usually from `.lsp.json`).

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | The executable to run (e.g., `typescript-language-server`). |
| `args` | string[] | Arguments for the executable (e.g., `["--stdio"]`). |
| `extensionToLanguage` | Record<string, string> | Mapping of file extensions to language IDs. |

### LspProcess
Internal state of a running LSP server.

| Field | Type | Description |
|-------|------|-------------|
| `process` | ChildProcess | The underlying Node.js child process. |
| `language` | string | The language ID this server handles. |
| `initialized` | boolean | Whether the `initialize` request has completed. |
| `openedFiles` | Set<string> | Files for which `didOpen` has been sent. |

### LspOperation
The arguments passed to the `lsp` tool.

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | The LSP operation (e.g., `hover`, `goToDefinition`). |
| `filePath` | string | The path to the file. |
| `line` | number | 1-based line number. |
| `character` | number | 1-based character offset. |

## State Transitions

1. **Uninitialized**: No server is running for the requested language.
2. **Starting**: `LspManager` spawns the child process.
3. **Initializing**: `initialize` request sent to the server.
4. **Ready**: Server is initialized and ready for requests.
5. **Synchronizing**: `didOpen` sent for a specific file.
6. **Executing**: Request (e.g., `hover`) sent to the server.
7. **Shutting Down**: `shutdown` and `exit` sent to the server.
