# UI Reporting: Subagent Activity

## Overview

Subagent activity is reported through the `shortResult` property of the `Agent` tool block. There is no separate `SubagentBlock` component. This ensures subagent progress is integrated into the main conversation flow while maintaining a clean UI.

## Progress Reporting

As the subagent executes tools and processes information, the `Agent` tool block's `shortResult` is updated in real-time.

### Display Format

The `shortResult` is displayed as a single line of text next to the tool name in the message list.

**Format**: `[ToolNameA, ToolNameB, ...] ([TotalTools] tools, [TotalTokens] tokens)`

### Real-time Updates

1. **Tool Execution**: When a subagent starts running a tool, the tool's name is added to the `lastTools` list.
2. **ShortResult Callback**: The `onShortResultUpdate` callback is triggered, updating the UI.
3. **Token Usage**: Token counts are updated as messages are processed.

**Example**: `... Read, Write (4 tools, 1,250 tokens)`

## Completion State

When the subagent completes its task:

1. **Tool Result**: The final assistant message from the subagent is returned as the tool's `content` and rendered in the main conversation.
2. **Final Summary**: The `shortResult` is updated to a final summary state.

**Example**: `Agent completed (5 tools, 1,500 tokens)`

## Error Handling

If a subagent task fails:

1. **Error Return**: The error message is returned as the tool's `error` property.
2. **ShortResult Update**: The `shortResult` is updated to reflect the error state.

**Example**: `Delegation error`

## Integration

### `Agent` Tool Implementation

The `Agent` tool is responsible for updating the `shortResult` via its `onUpdate` callback:

```typescript
// packages/agent-sdk/src/tools/agentTool.ts
onUpdate: () => {
  const messages = instance.messageManager.getMessages();
  const tokens = instance.messageManager.getLatestTotalTokens();
  const lastTools = instance.lastTools;

  const toolCount = countToolBlocks(messages);
  const summary = formatToolTokenSummary(toolCount, tokens);

  let shortResult = "";
  if (toolCount > 2) {
    shortResult += "... ";
  }
  if (lastTools.length > 0) {
    shortResult += `${lastTools.join(", ")} `;
  }

  shortResult += summary;

  context.onShortResultUpdate?.(shortResult);
}
```

### UI Component

The `ToolDisplay` component in the CLI renders the `shortResult`:

```tsx
// packages/code/src/components/ToolDisplay.tsx
{!isExpanded && shortResult && !error && (
  <Box paddingLeft={2} borderLeft borderColor="gray" flexDirection="column">
    {shortResult.split("\n").map((line, index) => (
      <Text key={index} color="gray" wrap="truncate-end">
        {line}
      </Text>
    ))}
  </Box>
)}
```

## Performance & Memory

- **Isolation**: Subagent messages are tracked in the subagent's isolated `MessageManager`.
- **Cleanup**: The subagent instance is cleaned up via `subagentManager.cleanupInstance(subagentId)` immediately after completion.
- **CLI Memory**: No subagent message history is persisted in the CLI's `useChat` state after completion (OOM protection).