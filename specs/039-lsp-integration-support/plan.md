# Plan: LSP Integration Support

## Phase 1: Core Infrastructure
1.  **Define Types**: Add LSP-related types to `packages/agent-sdk/src/types/index.ts`.
2.  **Implement LspManager**:
    *   Create `packages/agent-sdk/src/managers/lspManager.ts`.
    *   Implement process spawning and management.
    *   Implement JSON-RPC message framing and parsing.
    *   Implement basic lifecycle methods (`initialize`, `cleanup`).
3.  **Configuration Loading**: Implement logic to read `.lsp.json` from the workspace root.

## Phase 2: Tool Implementation
1.  **Create LspTool**:
    *   Create `packages/agent-sdk/src/tools/lspTool.ts`.
    *   Implement formatting logic for various LSP responses (Definition, Hover, References, etc.).
    *   Handle URI to file path conversion.
2.  **Register Tool**: Add `lspTool` to the `ToolManager`.

## Phase 3: Agent Integration
1.  **Integrate into Agent**:
    *   Add `LspManager` instance to `Agent` class.
    *   Initialize `LspManager` during agent startup.
    *   Ensure proper cleanup of LSP processes on agent shutdown.
2.  **Pass LspManager to ToolManager**: Update `ToolManager` to accept and provide `LspManager` to tools.

## Phase 4: Testing and Refinement
1.  **Unit Tests**:
    *   Test `LspManager` with mocked child processes.
    *   Test `lspTool` formatting logic.
2.  **Integration Testing**: Verify end-to-end functionality with a real LSP server (e.g., `typescript-language-server`).
3.  **Documentation**: Add usage instructions to `quickstart.md`.
