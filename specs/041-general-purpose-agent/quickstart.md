# Quickstart: General-Purpose Agent

## Overview
The `general-purpose` subagent is a built-in tool for Wave Agent that handles complex research and implementation tasks.

## Usage

### Via the Task Tool
The main agent can delegate tasks to the `general-purpose` subagent using the `Task` tool:

```typescript
await task({
  subagent_type: "general-purpose",
  description: "Research the authentication flow and implement a new login provider",
  prompt: "Please analyze the existing auth logic in packages/core and add a new provider for OAuth2."
});
```

## Capabilities
- **Full Tool Access**: Can use any tool available to the main agent, including `Edit`, `Write`, and `Bash`.
- **Deep Research**: Optimized for exploring large codebases and understanding complex architectures.
- **Implementation**: Can perform multi-step code modifications while following repository guidelines.

## Constraints
- **Absolute Paths**: Always returns absolute file paths in its final response.
- **No Proactive Docs**: Will not create `.md` or `README` files unless explicitly requested.
- **No Emojis**: Uses clear, professional communication without emojis.
