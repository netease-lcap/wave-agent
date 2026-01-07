# Requirements Checklist: LSP Integration Support

## Core Functionality
- [x] LSP server process management (start/stop/restart)
- [x] JSON-RPC communication over stdio
- [x] Support for multiple languages via configuration
- [x] Automatic `textDocument/didOpen` on file access
- [x] Mapping of file extensions to language IDs

## Supported LSP Features
- [x] `textDocument/definition` (Go to Definition)
- [x] `textDocument/hover` (Hover Information)
- [x] `textDocument/references` (Find References)
- [x] `textDocument/documentSymbol` (Document Symbols)
- [x] `workspace/symbol` (Workspace Symbols)
- [x] `textDocument/prepareCallHierarchy`
- [x] `callHierarchy/incomingCalls`
- [x] `callHierarchy/outgoingCalls`

## Integration
- [x] `LspManager` integrated into `Agent` lifecycle
- [x] `lspTool` registered in `ToolManager`
- [x] Configuration loaded from `.lsp.json`
- [x] Proper cleanup of processes on exit

## Quality Assurance
- [x] Unit tests for `LspManager` logic
- [x] Unit tests for `lspTool` response formatting
- [x] Error handling for missing servers or failed requests
- [x] Path normalization and URI handling
