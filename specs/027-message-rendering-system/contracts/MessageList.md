# Component Contract: MessageList

The `MessageList` component is the primary entry point for rendering the conversation history in the CLI.

## Props

```typescript
export interface MessageListProps {
  /** The list of messages to render */
  messages: Message[];
  /** Whether to show expanded details for blocks */
  isExpanded?: boolean;
  /** If true, all blocks are treated as static (no dynamic updates) */
  forceStatic?: boolean;
  /** Wave version to display in the welcome message */
  version?: string;
  /** Current working directory to display in the welcome message */
  workdir?: string;
  /** AI model name to display in the welcome message */
  model?: string;
  /** Callback triggered when the height of dynamic blocks is measured */
  onDynamicBlocksHeightMeasured?: (height: number) => void;
}
```

## Behavior

1. **Welcome Message**: Renders a header with version, model, and workdir information.
2. **Message Flattening**: Converts the nested `messages -> blocks` structure into a flat list of blocks for rendering.
3. **Static vs Dynamic Split**:
   - Blocks that are not the last message or are completed are considered **static**.
   - Active tool calls or running commands in the last message are considered **dynamic**.
4. **Static Rendering**: Uses Ink's `<Static>` component to render static blocks. This ensures they are only rendered once and then "frozen" in the terminal scrollback.
5. **Dynamic Rendering**: Renders dynamic blocks in a regular `<Box>`. This allows them to re-render and update their display (e.g., showing streaming text or a spinner).
6. **Message Limiting**: Only renders the last `maxMessages` (default 10) to prevent performance degradation in long sessions.
7. **Height Measurement**: Uses `measureElement` to calculate the height of dynamic blocks and reports it via `onDynamicBlocksHeightMeasured`.
