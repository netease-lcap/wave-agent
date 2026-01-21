# SubagentBlock Component Contract

## Component Props

```typescript
interface SubagentBlockProps {
  block: SubagentBlock;
  messageIndex: number; // Original index in main message list  
  isExpanded?: boolean; // Passed from parent (MessageList)
}
```

**Note**: The `isExpanded` state is passed through props from parent (following MessageList pattern), not managed locally.

## Visual Design

### Header Section
- **Border**: Distinctive border color using valid Ink colors (`magenta` or `cyan`)
- **Icon**: Subagent icon (🤖 or 🔗) 
- **Name**: Display subagent name/type
- **Status**: Visual indicator (🔄 loading, ✅ success, ❌ error)
- **Toggle**: Expand/collapse indicator (▼/▶) when `isExpanded` is false

### Collapsed State (when `isExpanded` is false)
- Shows header with subagent name and status
- Displays **up to 2 most recent** subagent messages
- Messages shown in compact format (similar to ToolResultDisplay shortResult)
- Border color: `magenta` to differentiate from regular messages

### Expanded State (when `isExpanded` is true)
- Shows header with subagent name and status
- Displays **up to 10 most recent** subagent messages
- Full message rendering using existing components
- No toggle indicator (expansion controlled globally)

## Message Rendering

### Reused Components
The SubagentBlock should reuse existing display components for subagent messages:

- **ToolResultDisplay**: For tool execution blocks within subagent
- **Standard text/error blocks**: Using MessageList rendering patterns

### Excluded Components
SubagentBlock should **NOT** render these block types:
- `command_output` blocks
- `image` blocks  
- `memory` blocks
- `diff` blocks (removed per user feedback)

## Behavior

### State Management
- `isExpanded` state passed through props from parent (following MessageList pattern)
- No local state management for expansion
- Component is controlled by global expand/collapse (Ctrl+O)

### Click Interactions
- **No click interactions**: Read-only display following existing component patterns
- Expansion controlled by global keyboard shortcut (Ctrl+O) like other message blocks

### Performance
- Lazy render: Only render visible messages in collapsed state
- Efficient re-rendering: Memoize message content when possible
- Memory management: Limit message history to 10 most recent

## Integration

### Message List Integration
```typescript
// In MessageList.tsx renderMessageItem function
{block.type === "subagent" && (
  <SubagentBlock 
    block={block} 
    messageIndex={originalIndex}
    isExpanded={isExpanded} // Pass through from MessageList props
  />
)}
```

### Valid Ink Colors
Use these colors consistently with existing components:
- `magenta`: Subagent border and icon
- `cyan`: Subagent name/type text
- `gray`: Secondary text and dimmed content
- `green`: Success status
- `red`: Error status  
- `yellow`: Loading status
- `white`: Message content text

### Error Handling
- Display subagent errors inline within block using `red` color
- Show connection/timeout errors in status indicator
- Graceful degradation if subagent messages unavailable