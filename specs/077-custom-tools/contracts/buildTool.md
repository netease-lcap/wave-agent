# buildTool() API Contract

## Factory Function

### `buildTool(def: ToolDef): ToolPlugin`

Accepts a `ToolDef` and returns a fully-formed `ToolPlugin` ready for registration.

**Input**: `ToolDef` — user-facing tool definition with required `name`, `description`, `parameters`, `execute` and optional `required`, `prompt`, `formatCompactParams`, `shouldDefer`, `alwaysLoad`, `additionalProperties`.

**Output**: `ToolPlugin` — internal tool representation with `config: ChatCompletionFunctionTool` auto-constructed from the input.

**Behavior**:
- Constructs `config.function.parameters` as `{ type: "object", properties: def.parameters, required: def.required || [], additionalProperties: def.additionalProperties ?? false }`.
- If `prompt` is a string, wraps it in `() => prompt`.
- Defaults: `shouldDefer: false`, `alwaysLoad: false`, `additionalProperties: false`.

## ToolDef Interface

```typescript
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  required?: string[];
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  prompt?: string | ((args?: PromptOptions) => string);
  formatCompactParams?: (params: Record<string, unknown>, context: ToolContext) => string;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  additionalProperties?: boolean;
}
```

## AgentOptions Extension

```typescript
interface AgentOptions {
  // ... existing fields
  customTools?: ToolPlugin[];
}
```

## Registration Flow

1. SDK user calls `Agent.create({ customTools: [tool1, tool2] })`.
2. `containerSetup.ts` passes `customTools` to `ToolManager` constructor.
3. `ToolManager.initializeBuiltInTools()` registers custom tools after built-in tools.
4. Each custom tool passes through `shouldEnableTool()` — respects `tools` whitelist and permission rules.
