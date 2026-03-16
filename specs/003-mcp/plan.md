# Plan: MCP Support Implementation

## Phase 1: Core Infrastructure
1.  **Define Types**: Create `packages/agent-sdk/src/types/mcp.ts` to define configuration and status interfaces.
2.  **Implement McpManager**: Create `packages/agent-sdk/src/managers/mcpManager.ts` to handle server lifecycles and tool execution.
3.  **Implement Utilities**: Create `packages/agent-sdk/src/utils/mcpUtils.ts` for schema cleaning and tool conversion.

## Phase 2: Integration
1.  **Integrate with Agent**:
    - Add `McpManager` to the `Agent` class.
    - Initialize `McpManager` in the `Agent` constructor and `initialize` method.
    - Add public API methods to `Agent` for MCP management.
2.  **Integrate with ToolManager**:
    - Pass `McpManager` to `ToolManager`.
    - Update `ToolManager.execute()` to handle MCP tools.
    - Update `ToolManager.list()` and `getToolsConfig()` to include MCP tools.
3.  **Integrate with PluginManager**:
    - Pass `McpManager` to `PluginManager` to allow plugins to interact with MCP.

## Phase 3: Testing and Examples
1.  **Unit Tests**:
    - Write tests for `McpManager` in `packages/agent-sdk/tests/managers/mcpManager.test.ts`.
    - Write tests for MCP tool integration in `packages/agent-sdk/tests/tools/mcpTools.test.ts`.
2.  **Examples**:
    - Create an example showing how to use MCP with Chrome in `packages/agent-sdk/examples/chrome-mcp.ts`.

## Phase 4: UI Support (Optional/Future)
1.  **McpManager Component**: Create an Ink component to display and manage MCP server status in the CLI.
