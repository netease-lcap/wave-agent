# Data Model: Custom Tools via buildTool()

## ToolDef (User-Facing Input)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Tool identifier (e.g., `"GetWeather"`) |
| `description` | `string` | Yes | — | Short description for the model |
| `parameters` | `Record<string, unknown>` | Yes | — | JSON Schema properties object |
| `required` | `string[]` | No | `[]` | List of required parameter names |
| `execute` | `(args, context) => Promise<ToolResult>` | Yes | — | Tool execution function |
| `prompt` | `string \| (args?) => string` | No | — | Tool description override (static or dynamic) |
| `formatCompactParams` | `(params, context) => string` | No | — | Compact display for tool block headers |
| `shouldDefer` | `boolean` | No | `false` | Hide from initial prompt until discovered |
| `alwaysLoad` | `boolean` | No | `false` | Always include in initial prompt |
| `additionalProperties` | `boolean` | No | `false` | Allow extra params in JSON schema |

## ToolPlugin (Internal Output)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Tool identifier |
| `config` | `ChatCompletionFunctionTool` | OpenAI-compatible tool schema |
| `execute` | `(args, context) => Promise<ToolResult>` | Execution function |
| `prompt` | `(args?) => string \| undefined` | Dynamic description function |
| `formatCompactParams` | `(params, context) => string \| undefined` | Compact display function |
| `shouldDefer` | `boolean` | Defer flag |
| `alwaysLoad` | `boolean` | Always-load flag |
| `isMcp` | `boolean \| undefined` | MCP flag (not set by buildTool) |

## AgentOptions (Addition)

| Field | Type | Description |
|-------|------|-------------|
| `customTools` | `ToolPlugin[]` | Custom tools registered alongside built-in tools |

## ToolManagerOptions (Addition)

| Field | Type | Description |
|-------|------|-------------|
| `customTools` | `ToolPlugin[]` | Custom tools passed from AgentOptions |

## Relationships

- `buildTool(ToolDef) → ToolPlugin` — Factory conversion.
- `AgentOptions.customTools → ToolManagerOptions.customTools → ToolManager.toolsRegistry` — Registration flow.
- Custom tools are stored in the same `toolsRegistry` Map as built-in tools, keyed by `name`.
- A custom tool with the same name as a built-in tool overwrites it.
