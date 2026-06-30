# Quick Start Guide: Real-Time Content Streaming

**Implementation Guide for Streaming Feature**  
**Target Audience**: Wave Agent developers
**Prerequisites**: Familiarity with TypeScript, React, and Wave Agent architecture

## Overview

This guide walks through implementing real-time content streaming in the Wave Agent codebase. The feature adds incremental content updates for assistant messages and tool parameters through new optional callbacks.

## Architecture Summary

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────┐
│   OpenAI API    │───▶│   Agent SDK      │───▶│   CLI Code    │
│   (Streaming)   │    │   (Callbacks)    │    │   (UI Update) │
└─────────────────┘    └──────────────────┘    └───────────────┘
         │                       │                       │
         │              ┌─────────────────┐             │
         └──────────────▶│ Content Buffers │◀────────────┘
                         │ Parameter Maps  │
                         │ Snapshot Store  │
                         └─────────────────┘
```

## Implementation Phases

### Phase 1: Agent SDK Streaming Support

#### 1.1 Enhance MessageManagerCallbacks

**File**: `packages/agent-sdk/src/managers/messageManager.ts`

```typescript
// Add new callback interfaces
export interface MessageManagerCallbacks {
  // ... existing callbacks
  
  // NEW: Streaming content callback
  onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
  
  // ENHANCED: Tool parameter streaming
  onToolBlockUpdated?: (params: AgentToolBlockUpdateParams) => void;
  
  // MODIFIED: Remove arguments for separation of concerns
  onAssistantMessageAdded?: () => void;  // Changed from (content?, toolCalls?)
}

// Enhanced tool block parameters
export interface AgentToolBlockUpdateParams {
  // ... existing fields
  
  // NEW: Streaming support - no additional fields needed
  // Parameters are passed via toolCall.parameters directly
}
```

#### 1.2 Add Streaming to AI Service

**File**: `packages/agent-sdk/src/services/aiService.ts`

```typescript
// Enhanced options interface
export interface CallAgentOptions {
  // ... existing options
  onContentUpdate?: (chunk: string, accumulated: string) => void;
  onToolUpdate?: (toolCall: StreamingToolCall) => void;
}

// Enhanced callAgent with streaming support
export async function callAgent(options: CallAgentOptions): Promise<CallAgentResult> {
  const stream = await openai.chat.completions.create({
    ...createParams,
    stream: true,
  });
  
  const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
  let contentBuffer = "";
  
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    
    // Handle content streaming
    if (choice.delta.content) {
      const chunk = choice.delta.content;
      contentBuffer += chunk;
      options.onContentUpdate?.(chunk, contentBuffer);
    }
    
    // Handle tool parameter streaming
    if (choice.delta.tool_calls) {
      processToolCallDeltas(choice.delta.tool_calls, toolCalls, options.onToolUpdate);
    }
  }
  
  return { content: contentBuffer, tool_calls: toolCalls };
}
```

#### 1.3 Performance Optimization

**Optimization**: ~~`packages/agent-sdk/src/utils/streamingHelpers.ts`~~ **REMOVED FOR PERFORMANCE**

Instead of complex JSON parsing utilities, we now use `parametersChunk` directly:

```typescript
/**
 * Extract complete parameters from incomplete JSON string
 * @param incompleteJson Incomplete JSON string from streaming
 * @returns Valid JSON object containing complete parameters
 */
export function extractStreamingParams(
  incompleteJson: string,
): Record<string, string | number | boolean | null> {
  if (!incompleteJson || typeof incompleteJson !== "string") {
    return {};
  }

  const result: Record<string, string | number | boolean | null> = {};

  // Match complete string parameters: "key": "value" (handle escaped quotes)
  const stringPattern = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = stringPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    let value = match[2];
    // Handle escaped characters
    value = value
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
    result[key] = value;
  }

  // Match complete number parameters: "key": 123 or "key": 123.45
  const numberPattern = /"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)\s*[,}]/g;
  while ((match = numberPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    const value = parseFloat(match[2]);
    result[key] = value;
  }

  // Match complete boolean parameters: "key": true or "key": false
  const boolPattern = /"([^"]+)"\s*:\s*(true|false)\s*[,}]/g;
  while ((match = boolPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    const value = match[2] === "true";
    result[key] = value;
  }

  // Match complete null parameters: "key": null
  const nullPattern = /"([^"]+)"\s*:\s*null\s*[,}]/g;
  while ((match = nullPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    result[key] = null;
  }

  return result;
}



// Optimized tool call streaming using parametersChunk
export function accumulateToolCall(
  delta: any, 
  existing: ChatCompletionMessageFunctionToolCall[],
  onUpdate?: (toolCall: StreamingToolCall) => void
): void {
  // Accumulate parameters string from delta
  const updatedParameters = /* accumulate from delta */;
  
  // Use parametersChunk directly as compact param for performance
  const parametersChunk = delta.function?.arguments || '';
  
  // Trigger callback with optimized parameters
  onUpdate?.({
    id: /* tool call id */,
    name: /* tool name */,
    parameters: updatedParameters,
    compactParams: compactParams, // Computed by extractStreamingParams + generateCompactParams
  });
}
```

#### 1.4 Integrate with AIManager and MessageManager

**File**: `packages/agent-sdk/src/managers/aiManager.ts`

```typescript
export class AIManager {
  public async sendAIMessage(options = {}): Promise<void> {
    // Create empty assistant message slot before streaming
    this.messageManager.addAssistantMessage('', []);
    
    // Enhanced to support streaming
    const result = await callAgent({
      // ... existing options
      onContentUpdate: (chunk, accumulated) => {
        // Update current message and trigger onMessagesChange
        this.messageManager.updateCurrentMessageContent(chunk, accumulated);
      },
      onToolUpdate: (toolCall) => {
        // Update tool parameters and trigger callbacks
        this.messageManager.updateToolBlock(toolCall);
      },
    });
  }
}
```

**File**: `packages/agent-sdk/src/managers/messageManager.ts`

```typescript
export class MessageManager {
  updateCurrentMessageContent(chunk: string, accumulated: string): void {
    // Update the current assistant message content
    const currentMessage = this.getCurrentAssistantMessage();
    if (currentMessage && currentMessage.blocks.length > 0) {
      currentMessage.blocks[0].content = accumulated; // Use accumulated for full content
      
      // Trigger streaming callback for UI feedback with both chunk and accumulated
      this.callbacks.onAssistantContentUpdated?.(chunk, accumulated);
      
      // Trigger existing onMessagesChange to update UI
      this.callbacks.onMessagesChange?.(this.messages);
    }
  }
  
  updateToolBlock(toolCall: StreamingToolCall): void {
    // Update tool block parameters
    const toolBlock = this.findToolBlock(toolCall.id);
    if (toolBlock) {
      toolBlock.parameters = toolCall.rawParameters;
      // Tool block updated with streaming parameters
      
      // Trigger callbacks
      this.callbacks.onToolBlockUpdated?.(toolBlock);
      this.callbacks.onMessagesChange?.(this.messages);
    }
  }
}
```

### Phase 2: CLI Interface Integration

#### 2.1 Update CLI Printing

**File**: `packages/code/src/print-cli.ts`

```typescript
// Update CLI to print streaming content in real-time
export const printCLI = (agent: Agent) => {
  // Set up streaming callbacks for real-time printing
  agent.onAssistantContentUpdated = (chunk: string, accumulated: string) => {
    // Clear previous line and print updated content
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(content);
  };
  
  agent.onToolBlockUpdated = (params: AgentToolBlockUpdateParams) => {
    // Print tool parameters as they stream in
    const toolCall = params.toolCall;
    if (toolCall.parameters) {
      process.stdout.write(`\nTool: ${toolCall.name}\nParameters: ${JSON.stringify(toolCall.parameters, null, 2)}\n`);
    }
  };
  
  agent.onAssistantMessageAdded = () => {
    // Start new line for streaming content
    process.stdout.write('\nAssistant: ');
  };
  
  // Existing onMessagesChange handles final message state
  agent.onMessagesChange = (messages: Message[]) => {
    // Final message printing logic remains unchanged
  };
};
```

## Testing Strategy

### Unit Tests

**File**: `packages/agent-sdk/tests/services/aiService.test.ts` (add to existing tests)

```typescript
// Add these streaming tests to existing aiService test suite
describe('callAgent streaming', () => {
  it('should accumulate content chunks correctly', async () => {
    const mockStream = createMockOpenAIStream([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] },
    ]);
    
    let accumulatedContent = '';
    await callAgent({
      onContentUpdate: (chunk, accumulated) => {
        accumulatedContent = accumulated;
      },
    });
    
    expect(accumulatedContent).toBe('Hello world');
  });
  
  it('should handle tool parameter streaming', async () => {
    // Test tool call parameter accumulation
  });
  
  it('should handle incomplete JSON gracefully', async () => {
    // Test partial JSON parsing
  });
});
```

### Integration Tests

**File**: `packages/agent-sdk/tests/agent/agent.streaming.test.ts`

```typescript
describe('Agent streaming integration', () => {
  let agent: Agent;
  
  beforeEach(async () => {
    agent = await Agent.create({
      // Mock AI service and tool manager to prevent real I/O
      // Follow patterns from existing agent tests
    });
  });
  
  it('should stream assistant content through onAssistantContentUpdated', async () => {
    const contentUpdates: string[] = [];
    
    agent.onAssistantContentUpdated = (chunk: string, accumulated: string) => {
      contentUpdates.push(accumulated);
    };
    
    // Mock streaming response and trigger agent processing
    // Verify content accumulates correctly: ['Hello', 'Hello world', 'Hello world!']
    
    expect(contentUpdates).toEqual(['Hello', 'Hello world', 'Hello world!']);
  });
  
  it('should stream tool parameters through onToolBlockUpdated', async () => {
    const paramUpdates: any[] = [];
    
    agent.onToolBlockUpdated = (params: AgentToolBlockUpdateParams) => {
      paramUpdates.push(params.toolCall.parameters);
    };
    
    // Mock tool call streaming and verify parameter accumulation
    
    expect(paramUpdates.length).toBeGreaterThan(0);
    expect(paramUpdates[paramUpdates.length - 1]).toMatchObject({
      // Expected final parameters
    });
  });
  
  it('should trigger onMessagesChange after streaming updates', async () => {
    const messageChanges: Message[][] = [];
    
    agent.onMessagesChange = (messages: Message[]) => {
      messageChanges.push([...messages]);
    };
    
    // Mock streaming and verify final message state
    
    expect(messageChanges.length).toBeGreaterThan(0);
    const finalMessages = messageChanges[messageChanges.length - 1];
    expect(finalMessages[finalMessages.length - 1].content).toBe('Hello world!');
  });
});
```

## Deployment Checklist

### Phase 1 Checklist (Agent SDK)
- [ ] Enhance MessageManagerCallbacks interface
- [ ] Implement streaming in aiService.ts
- [ ] ~~Create streamingHelpers.ts utilities~~ OPTIMIZED: Removed for performance
- [ ] Update AIManager integration
- [ ] Write unit tests for streaming logic
- [ ] Run `pnpm build` and verify exports

### Phase 2 Checklist (CLI Code)
- [ ] Update useChat context with streaming support
- [ ] Enhance MessageList component rendering  
- [ ] Implement simple view mode controls
- [ ] Write integration tests
- [ ] Test view mode transitions

## Troubleshooting

### Common Issues

**Issue**: Content updates not appearing in collapsed mode  
**Solution**: Check that `isExpandedRef.current` is false in `onMessagesChange`

**Issue**: UI not freezing in expanded mode  
**Solution**: Verify `onMessagesChange` is properly checking `isExpandedRef.current`

**Issue**: Tool parameters not updating during streaming  
**Solution**: Check `onToolBlockUpdated` callback integration with Agent SDK

### Performance Monitoring

```typescript
// Simple debugging for development
if (process.env.NODE_ENV === 'development') {
  console.log(`Content update: ${content.length} chars`);
  console.log(`View mode: ${isExpanded ? 'expanded' : 'collapsed'}`);
}
```

## Next Steps

After implementing the basic streaming functionality:

1. **Enhanced Tool Support**: Add streaming for complex tools with large outputs
2. **Progress Indicators**: Visual progress bars for long-running operations
3. **Streaming History**: Save and replay streaming sessions
4. **Advanced Parsing**: Support for streaming structured data formats
5. **Network Resilience**: Automatic reconnection for interrupted streams

This quick start guide provides the foundation for implementing streaming functionality while maintaining the quality and performance standards of the Wave Agent codebase.