# Component Contract: MessageBlockItem

The `MessageBlockItem` component is responsible for rendering a single `MessageBlock`.

## Props

```typescript
export interface MessageBlockItemProps {
  /** The block to render */
  block: MessageBlock;
  /** The message containing this block */
  message: Message;
  /** Whether to show expanded details */
  isExpanded: boolean;
  /** Optional top padding */
  paddingTop?: number;
}
```

## Rendering Logic

The component switches on `block.type` to render the appropriate UI:

- **text**:
  - If `message.role === "user"` or `isExpanded`, renders as plain text (with background for user messages).
  - Otherwise, renders using the `Markdown` component.
  - Supports `customCommandContent` prefix (`$ `) and `HOOK` source prefix (`~ `).
- **error**: Renders in red with an "Error: " prefix.
- **bang**: Delegates to `BangDisplay`.
- **tool**: Delegates to `ToolDisplay`.
- **image**: Renders an "# Image" label with the count of images.
- **compress**: Delegates to `CompressDisplay`.
- **reasoning**: Delegates to `ReasoningDisplay`.
