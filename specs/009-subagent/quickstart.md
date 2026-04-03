# Quickstart Guide: Subagent Support

## Overview

This guide walks through implementing subagent support in Wave Agent, enabling task delegation to specialized AI personalities with isolated contexts and tool access.

## Implementation Phases

### Phase 1: Core Infrastructure (agent-sdk)

#### 1.1 Create Agent Tool
```bash
cd packages/agent-sdk/src/tools
# Create agentTool.ts following existing tool patterns
# Add to tools/index.ts exports
# Update toolManager.ts registration
```

#### 1.2 Create Subagent Manager
```bash
cd packages/agent-sdk/src/managers
# Create subagentManager.ts for lifecycle management
# Add to managers/index.ts exports
```

#### 1.3 Add Configuration Parser
```bash
cd packages/agent-sdk/src/utils
# Create subagentParser.ts for on-demand YAML parsing
# Simple filesystem reading without caching or watching
```

#### 1.4 Implement Subagent Callbacks
```bash
cd packages/agent-sdk/src/managers
# Add subagent callbacks to SubagentManagerCallbacks interface
# Implement callback invocation in subagentManager.ts
```

### Phase 2: UI Integration (code)

#### 2.1 Update Tool Display
```bash
cd packages/code/src/components
# Update ToolDisplay.tsx to handle dynamic shortResult updates
# Ensure the Agent tool block reflects subagent progress
```

#### 2.2 Register Callbacks
```bash
cd packages/code/src/contexts
# Update useChat.tsx to register subagent callbacks
# Update the Agent tool's onShortResultUpdate callback
```

## Key Implementation Details

### Agent Tool Schema
```typescript
export const agentTool: ToolPlugin = {
  name: "Agent",
  config: {
    type: "function",
    function: {
      name: "Agent",
      description: "Launch a new agent to handle complex, multi-step tasks autonomously.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "A short (3-5 word) description of the task"
          },
          prompt: {
            type: "string", 
            description: "The task for the agent to perform"
          },
          subagent_type: {
            type: "string",
            description: "The type of specialized agent to use for this task"
          },
          run_in_background: {
            type: "boolean",
            description: "Set to true to run this command in the background."
          }
        },
        required: ["description", "prompt", "subagent_type"]
      }
    }
  }
};
```

### Subagent Configuration Format
```yaml
# File: .wave/agents/code-reviewer.md
---
name: code-reviewer
description: Reviews code changes for best practices, bugs, and improvements
tools: ["Read", "Grep", "Diff"] 
model: sonnet
---

You are a senior code reviewer specializing in TypeScript and React applications.
Your role is to thoroughly analyze code changes and provide constructive feedback.
```

### Subagent Progress Reporting

Dedicated subagent-specific callbacks through the `SubagentManagerCallbacks` interface provide real-time updates for the `Agent` tool's `shortResult`.

#### Basic Usage

```typescript
// packages/agent-sdk/src/tools/agentTool.ts
const instance = await subagentManager.createInstance(
  configuration,
  parameters,
  run_in_background,
  () => {
    // onUpdate callback to refresh shortResult
    const messages = instance.messageManager.getMessages();
    const tokens = instance.messageManager.getLatestTotalTokens();
    const lastTools = instance.lastTools;
    
    const toolCount = countToolBlocks(messages);
    const summary = formatToolTokenSummary(toolCount, tokens);
    
    let shortResult = `${lastTools.join(", ")} ${summary}`;
    context.onShortResultUpdate?.(shortResult);
  }
);
```

## Testing Strategy

### Unit Tests
```bash
# agent-sdk tests
packages/agent-sdk/tests/tools/agentTool.test.ts
packages/agent-sdk/tests/managers/subagentManager.test.ts  
packages/agent-sdk/tests/utils/subagentParser.test.ts
```

### Integration Tests
```bash
# Create temporary .wave/agents/ directory
# Test real YAML parsing and subagent execution
# Test tool result return flow
# Test message isolation and cleanup
```

## Troubleshooting

### Common Issues
1. **YAML parsing errors**: Check frontmatter syntax
2. **Tool access denied**: Verify tools list in config
3. **Subagent recursion**: Ensure subagents cannot call the `Agent` tool
4. **Memory leaks**: Verify `cleanupInstance` is called after completion
5. **UI not updating**: Check `onShortResultUpdate` callback registration

This quickstart provides the foundation for implementing subagent support using the standard tool-calling pattern and real-time progress reporting.