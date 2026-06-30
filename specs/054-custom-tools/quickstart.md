# Quickstart: Custom Tools via buildTool()

## Overview

Wave SDK now supports defining custom tools via a `buildTool()` factory function. Custom tools are registered alongside built-in tools and are callable by the model.

## Basic Usage

```typescript
import { Agent, buildTool, type ToolContext, type ToolResult } from "wave-agent-sdk";

// Define a custom tool
const myTool = buildTool({
  name: "GetWeather",
  description: "Get the current weather for a city",
  parameters: {
    city: { type: "string", description: "The city name" },
  },
  required: ["city"],
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    return { success: true, content: `Sunny in ${args.city}` };
  },
});

// Pass to Agent
const agent = await Agent.create({
  customTools: [myTool],
});
```

## Advanced Features

### Dynamic Prompt

```typescript
const contextTool = buildTool({
  name: "ContextAware",
  description: "A tool that adapts its description",
  parameters: {},
  prompt: ({ availableSkills, workdir }) =>
    `Available skills: ${availableSkills?.map(s => s.name).join(", ")}. Working in: ${workdir}`,
  execute: async () => ({ success: true, content: "Done" }),
});
```

### Compact Display

```typescript
const fileTool = buildTool({
  name: "FileOp",
  description: "Perform a file operation",
  parameters: { path: { type: "string" }, action: { type: "string" } },
  formatCompactParams: (params, context) => `${params.action} ${params.path}`,
  execute: async () => ({ success: true, content: "Done" }),
});
```

### Allow Extra Parameters

```typescript
const flexibleTool = buildTool({
  name: "FlexibleTool",
  description: "Accepts any parameters",
  parameters: {},
  additionalProperties: true, // Allow arbitrary extra params
  execute: async (args) => ({ success: true, content: JSON.stringify(args) }),
});
```

## Tool Whitelisting

Custom tools respect the `tools` whitelist just like built-in tools:

```typescript
const agent = await Agent.create({
  customTools: [toolA, toolB],
  tools: ["ToolA"], // Only ToolA is enabled; ToolB is filtered out
});
```

## Override Built-in Tools

A custom tool with the same name as a built-in tool replaces it:

```typescript
const customBash = buildTool({
  name: "Bash", // Overrides built-in Bash
  description: "Restricted bash — only allows ls",
  parameters: { command: { type: "string" } },
  execute: async (args) => {
    if (args.command !== "ls") {
      return { success: false, error: "Only 'ls' is allowed" };
    }
    // ... custom implementation
  },
});
```
