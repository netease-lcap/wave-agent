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
  isDynamic: boolean;
  key: string;
}
```

- **isDynamic**: True if `forceStatic` is false AND `isExpanded` is false AND the message contains at least one active block AND the block is not a completed `text` or `reasoning` block (`stage === "end"`).
- An active block is a `tool` block in the `running` stage, a `bang` block with `isRunning` set to true, or a `slash` block in the `running` stage.
- When `isExpanded` is true, everything is static.
- **key**: A unique identifier for the block, typically `${message.id}-${blockIndex}`.
