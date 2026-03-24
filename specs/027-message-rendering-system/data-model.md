# Data Model: Message Rendering System

## Message Structure

The rendering system operates on the `Message` and `MessageBlock` types defined in the SDK.

### Message
```typescript
export interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage;
  additionalFields?: Record<string, unknown>;
}
```

### MessageBlock
A discriminated union of various block types:
- `TextBlock`: Regular text or markdown content.
- `ErrorBlock`: Error messages.
- `ToolBlock`: Tool execution details (parameters, results, stage).
- `ImageBlock`: References to images.
- `BangBlock`: Shell command execution details.
- `CompressBlock`: Compressed message history.
- `ReasoningBlock`: Agent's internal reasoning.

## Rendering Metadata

When rendering the message list, blocks are augmented with metadata:

### BlockWithStatus
```typescript
interface BlockWithStatus {
  block: MessageBlock;
  message: Message;
  messageIndex: number;
  isLastMessage: boolean;
  isDynamic: boolean;
  key: string;
}
```

- **isDynamic**: True if the block is currently active (e.g., a tool in `start`, `streaming`, or `running` stage, or a running `bang` command).
- **key**: A unique identifier for the block, typically `${message.id}-${blockIndex}`.
