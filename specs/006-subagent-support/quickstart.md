# Quickstart Guide: Subagent Support

## Overview

This guide walks through implementing subagent support in Wave Agent, enabling task delegation to specialized AI personalities with isolated contexts and tool access.

## Implementation Phases

### Phase 1: Core Infrastructure (agent-sdk)

#### 1.1 Create Task Tool
```bash
cd packages/agent-sdk/src/tools
# Create taskTool.ts following existing tool patterns
# Add to tools/index.ts exports
# Update toolManager.ts registration
```

#### 1.2 Extend Message Types
```bash
cd packages/agent-sdk/src
# Add SubagentBlock type to types.ts
# Update MessageBlock union type
# Add subagent-specific callback types
```

#### 1.3 Create Subagent Manager
```bash
cd packages/agent-sdk/src/managers
# Create subagentManager.ts for lifecycle management
# Add to managers/index.ts exports
```

#### 1.4 Add Configuration Parser
```bash
cd packages/agent-sdk/src/utils
# Create subagentParser.ts for on-demand YAML parsing
# Simple filesystem reading without caching or watching
```

#### 1.5 Extend Message Manager
```bash
cd packages/agent-sdk/src/managers
# Add subagent callbacks to MessageManagerCallbacks
# Implement callback invocation in message operations
```

### Phase 2: UI Components (code)

#### 2.1 Create Subagent Block Component
```bash
cd packages/code/src/components
# Create SubagentBlock.tsx with expand/collapse logic
# Implement message filtering (2 collapsed, 10 expanded)
# Add distinctive styling and status indicators
```

#### 2.2 Extend Message List
```bash
cd packages/code/src/components
# Update MessageList.tsx to handle SubagentBlock rendering
# No additional callback handling needed - onMessagesChange covers subagent blocks
# Add SubagentBlock component import and rendering logic
```

#### 2.3 Update App Integration
```bash
cd packages/code/src
# No changes needed to useChat.tsx - existing onMessagesChange handles subagents
# SubagentBlock components integrate with standard message flow
# Expansion state managed locally in SubagentBlock components
```

## Key Implementation Details

### Task Tool Schema
```typescript
export const taskTool: ToolPlugin = {
  name: "Task",
  config: {
    type: "function",
    function: {
      name: "Task",
      description: "Delegate specialized tasks to configured subagents",
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

Focus on:
- Code quality and maintainability
- Performance implications
- Security considerations  
- Best practices adherence
- Bug identification
```

### Message Manager Callback Extension
```typescript
export interface MessageManagerCallbacks {
  // Existing callbacks...
  onSubAgentBlockAdded?: (sessionId: string) => void;
  onSubAgentBlockUpdated?: (sessionId: string, messages: Message[]) => void;
}
```

### Subagent Block Type
```typescript
export interface SubagentBlock {
  type: "subagent";
  sessionId: string;
  subagentName: string;
  status: 'active' | 'completed' | 'error';
  messages: Message[];

}
```

## Testing Strategy

### Unit Tests
```bash
# agent-sdk tests
packages/agent-sdk/tests/tools/taskTool.test.ts
packages/agent-sdk/tests/managers/subagentManager.test.ts  
packages/agent-sdk/tests/utils/subagentParser.test.ts

# code tests
packages/code/tests/components/SubagentBlock.test.tsx
```

### Integration Tests
```bash
# Create temporary .wave/agents/ directory
# Test real YAML parsing and subagent execution
# Test UI callback integration
# Test message isolation between main and subagent
```

### Example Integration Test
```typescript
describe('Subagent Integration', () => {
  test('complete task delegation flow', async () => {
    // Setup temporary config
    const configDir = await createTempDir();
    await writeFile(`${configDir}/test-agent.md`, `
---
name: test-agent
description: Test agent for validation
---
Test system prompt
`);

    // Execute task tool
    const result = await taskTool.execute({
      description: "Test task",
      prompt: "Perform test validation", 
      subagent_type: "test-agent"
    }, { workdir: configDir });

    expect(result.success).toBe(true);
    expect(result.subagentSessionId).toBeDefined();
    expect(callbacks.onSubAgentBlockAdded).toHaveBeenCalled();
  });
});
```

## Configuration Setup

### Project-Level Subagents
```bash
mkdir -p .wave/agents
cat > .wave/agents/code-reviewer.md << EOF
---
name: code-reviewer
description: PROACTIVELY reviews code for quality and best practices
tools: ["Read", "Grep", "Edit"]
model: sonnet
---
You are an expert code reviewer...
EOF
```

### User-Level Subagents  
```bash
mkdir -p ~/.wave/agents
cat > ~/.wave/agents/general-helper.md << EOF
---
name: general-helper
description: Helps with general development tasks
---
You are a helpful development assistant...
EOF
```

## Build & Deployment

### Build Process
```bash
# Build agent-sdk first (dependency)
cd packages/agent-sdk
pnpm build

# Build code package
cd ../code  
pnpm build

# Type checking and linting
cd ../..
pnpm run type-check
pnpm run lint
```

### Verification
```bash
# Test subagent loading
wave-code --help  # Should start without errors

# Test task delegation
echo "Use the code-reviewer subagent to check my TypeScript files" | wave-code

# Verify UI components
# Check that subagent blocks appear with proper styling
# Verify expand/collapse behavior
# Test message preview (2 collapsed, 10 expanded)
```

## Performance Monitoring

### Key Metrics
- Subagent selection time: <500ms
- Instance creation time: <2000ms  
- Total task overhead: <150% of main agent time
- Memory usage: Cleanup after task completion
- UI responsiveness: <100ms for expand/collapse

## Troubleshooting

### Common Issues
1. **YAML parsing errors**: Check frontmatter syntax
2. **Tool access denied**: Verify tools list in config
3. **UI not updating**: Check callback registration
4. **Context bleeding**: Verify instance isolation
5. **Performance issues**: Check message limiting


This quickstart provides the foundation for implementing subagent support while maintaining the existing architecture patterns and performance requirements.