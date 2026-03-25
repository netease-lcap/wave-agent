# Quickstart: Prompt Engineering Framework

## Overview

The Prompt Engineering Framework provides a structured way to manage and optimize the prompts used by the agent. It centralizes all system prompts and tool descriptions, allowing for dynamic generation based on context.

## Basic Usage

### Registering a Prompt

```typescript
import { promptRegistry } from "@wave-agent/agent-sdk";

promptRegistry.register("SYSTEM_PROMPT", "You are a helpful assistant. Current directory: {{workdir}}");
```

### Getting a Prompt

```typescript
const prompt = promptRegistry.get("SYSTEM_PROMPT", { workdir: "/home/user/project" });
// Output: "You are a helpful assistant. Current directory: /home/user/project"
```

### Dynamic Tool Prompts

Tools can still provide their own prompts, which will be integrated into the framework:

```typescript
export const myTool: ToolPlugin = {
  name: "my_tool",
  // ...
  prompt: (context) => {
    return `This tool is available in ${context.workdir}`;
  }
};
```

## Development

To add a new prompt to the framework:
1.  Add the prompt template to the registry in `packages/agent-sdk/src/prompts/registry.ts`.
2.  Use the registry to retrieve the prompt in `packages/agent-sdk/src/prompts/index.ts`.
