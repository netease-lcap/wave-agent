# Agent Data Structure Documentation

This document captures the data structures used by the wave-agent-sdk for testing purposes.

## Message Interface

```typescript
interface Message {
    role: "user" | "assistant";
    blocks: MessageBlock[];
    usage?: Usage;
    metadata?: Record<string, unknown>;
}
```

## MessageBlock Types

The system supports several block types:

### TextBlock
```typescript
interface TextBlock {
    type: "text";
    content: string;
    customCommandContent?: string;
    source?: MessageSource; // "user" | "hook"
}
```

### ToolBlock  
```typescript
interface ToolBlock {
    type: "tool";
    parameters?: string;
    result?: string;
    shortResult?: string;
    images?: Array<{
        data: string;
        mediaType?: string;
    }>;
    id?: string;
    name?: string;
    stage: "start" | "streaming" | "running" | "end";
    success?: boolean;
    error?: string | Error;
    compactParams?: string;
    parametersChunk?: string;
}
```

### ErrorBlock
```typescript
interface ErrorBlock {
    type: "error";
    content: string;
}
```

## Key Concepts for Testing

1. **Messages** contain an array of **blocks** that represent different content types
2. **TextBlocks** contain the main conversational content
3. **ToolBlocks** represent function calls and their execution states
4. **ToolBlock.stage** tracks execution progress: start → streaming → running → end
5. **ErrorBlocks** contain error messages to display to users

## Callback Events

The agent uses these callbacks for real-time updates:

- `onMessagesChange(messages: Message[])` - Full message list update
- `onAssistantContentUpdated(chunk: string, accumulated: string)` - Streaming text content
- `onAssistantMessageAdded()` - New assistant message started
- `onToolBlockUpdated(params: AgentToolBlockUpdateParams)` - Tool execution updates
- `onErrorBlockAdded(error: string)` - Error occurred