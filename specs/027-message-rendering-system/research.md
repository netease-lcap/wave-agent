# Research: Message Rendering System

## Decision: Ink's Static Component for History
- **Rationale**: Rendering a long list of messages in Ink can be slow if every message is re-evaluated on every update. Using the `<Static>` component allows us to "print" historical messages once and then ignore them during subsequent re-renders, significantly improving performance.
- **Alternatives considered**: 
    - Manual memoization: Rejected because `<Static>` is the idiomatic way in Ink to handle append-only lists that don't change.

## Decision: Dynamic Rendering for Active Blocks
- **Rationale**: Active tool calls, running commands, and streaming text need to update their display in real-time. These cannot be rendered inside `<Static>`. We separate them into a "dynamic" section that re-renders normally.
- **Alternatives considered**: 
    - Re-rendering the whole list: Rejected due to performance issues with long histories.

## Decision: Message Flattening
- **Rationale**: Messages contain multiple blocks (text, tools, etc.). Flattening them into a single list of blocks makes it easier to manage the static/dynamic split at the block level rather than the message level.
- **Alternatives considered**: 
    - Message-level rendering: Rejected because a single message might contain both completed (static) and active (dynamic) blocks.

## Decision: Height Measurement for Layout
- **Rationale**: The CLI needs to know the height of the dynamic content to manage scrolling and input positioning correctly. Using `measureElement` from Ink allows us to report this height back to the parent container.

## Integration Points
- `MessageList`: Main entry point for rendering the conversation.
- `MessageBlockItem`: Dispatcher for different block types.
- `Static`: Ink component for performance optimization.
- `measureElement`: Ink utility for layout management.
