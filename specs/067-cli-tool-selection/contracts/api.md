# API Contracts: CLI Tool Selection

## Agent SDK

### `AgentOptions` Interface

The `AgentOptions` interface in `packages/agent-sdk/src/agent.ts` will be updated to include a `tools` property.

```typescript
export interface AgentOptions {
  // ... existing properties
  /**
   * Optional list of tool names to enable.
   * - undefined: Enable all built-in tools and plugins (default).
   * - []: Disable all tools.
   * - string[]: Enable only the tools with the specified names.
   */
  tools?: string[];
}
```

### `Agent.create` Static Method

The `Agent.create` method will accept the updated `AgentOptions`.

```typescript
static async create(options: AgentOptions): Promise<Agent>;
```

## CLI Options

### `CliOptions` Interface

The `CliOptions` interface in `packages/code/src/cli.tsx` will be updated to include a `tools` property.

```typescript
export interface CliOptions {
  // ... existing properties
  /**
   * Comma-separated list of tools to enable.
   * - "default": Enable all tools.
   * - "": Disable all tools.
   * - "Tool1,Tool2": Enable specific tools.
   */
  tools?: string[];
}
```

## Tool Manager

### `ToolManagerOptions` Interface

The `ToolManagerOptions` interface in `packages/agent-sdk/src/managers/toolManager.ts` will be updated to include `tools`.

```typescript
export interface ToolManagerOptions {
  // ... existing properties
  tools?: string[];
}
```

## AI Manager

### `sendAIMessage` Method

The `sendAIMessage` method in `packages/agent-sdk/src/managers/aiManager.ts` will **not** take a `tools` argument. Instead, it will rely on the `ToolManager` injected into its container to determine available tools.

```typescript
public async sendAIMessage(
  options: {
    recursionDepth?: number;
    model?: string;
    allowedRules?: string[];
    maxTokens?: number;
  } = {},
): Promise<void>;
```
