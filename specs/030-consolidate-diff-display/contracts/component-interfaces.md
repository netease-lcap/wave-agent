# Component Interfaces: Consolidate Diff Display

**Feature**: 030-consolidate-diff-display  
**Date**: 2025-12-11

## Core Interfaces

### 1. ToolResultDisplayProps (EXISTING - Updated behavior only)
```typescript
interface ToolResultDisplayProps {
  toolResult: ToolResult;
  isExpanded: boolean;
  onToggleExpand: () => void;
  className?: string;
}
```
**Behavior Changes**: Component now conditionally renders diff display when `toolResult.toolName` matches supported tools (Write, Edit, MultiEdit) and `stage` is 'running' or 'end'.

### 2. Change Interface (NEW - in agent-sdk)
```typescript
interface Change {
  oldContent: string;
  newContent: string;
}
```
**Purpose**: Simplified change representation containing old and new content for diff comparison. Empty string represents absence of content (for pure additions or deletions).

### 3. Agent-SDK Export Function (NEW)
```typescript
export function transformToolBlockToChanges(toolResult: ToolResult): Change[]
```
**Location**: `packages/agent-sdk/src/utils/diff-transform.ts`  
**Export**: `packages/agent-sdk/src/index.ts`  
**Purpose**: Transform tool parameters into standardized Change[] array for UI rendering.

## Behavioral Contracts

### Agent-SDK Function Contract

**Input**: ToolResult with tool-specific parameters
**Output**: Change[] array representing diff content
**Behavior**:
- Extract relevant parameters based on `toolResult.toolName`
- Return appropriate Change[] for each tool type:
  - **Write**: Single change with `oldContent: ""` and `newContent: parameters.content`
  - **Edit**: Single change with `oldContent: parameters.old_string` and `newContent: parameters.new_string`
  - **MultiEdit**: Multiple changes from `parameters.edits[]` array, each with respective old/new content
- Return empty array `[]` for unsupported tool types
- Handle missing/invalid parameters gracefully (return empty array)

### ToolResultDisplay Diff Integration Contract

**Trigger Conditions**:
- `toolResult.toolName` in ['Write', 'Edit', 'MultiEdit']
- `toolResult.stage` in ['running', 'end']  
- `transformToolBlockToChanges(toolResult)` returns non-empty array

**Display Behavior**:
- **Collapsed State**: Show diff summary (file path, addition/deletion counts)
- **Expanded State**: Show full unified diff format with color coding
- **Always Visible**: Diff content rendered in both collapsed and expanded states
- **Unlimited Display**: No truncation or pagination of diff content

### Color and Format Contract

**Color Scheme** (matching DiffViewer.tsx):
- **Green**: Addition lines ('+' prefix) and word-level additions (backgroundColor="green")
- **Red**: Deletion lines ('-' prefix) and word-level deletions (backgroundColor="red")
- **White/Default**: Context lines (' ' prefix)

**Format**:
- Standard unified diff format using `diffLines` from diff library
- Word-level highlighting using `diffWords` for line-by-line comparisons
- File headers with path information (when available)
- Line-by-line changes with appropriate prefixes
- Word-level background highlighting for precise changes

## Error Handling Contract

### Agent-SDK Function Error Handling
```typescript
function transformToolBlockToChanges(toolResult: ToolResult): Change[] {
  try {
    // Transformation logic
  } catch (error) {
    console.warn('Failed to transform tool result to changes:', error);
    return []; // Always return valid Change[] array
  }
}
```

### UI Component Error Handling
- Invalid/empty Change[] array: Render no diff content (graceful degradation)
- Missing parameters: Use agent-sdk function's error handling (returns empty array)
- Rendering errors: Fallback to text display of tool result

## Integration Points

### ToolResultDisplay Component Integration
```typescript
import { transformToolBlockToChanges } from '@/wave-agent-sdk';

function ToolResultDisplay({ toolResult, isExpanded }: Props) {
  const changes = useMemo(() => 
    transformToolBlockToChanges(toolResult), 
    [toolResult]
  );
  
  const showDiff = changes.length > 0 && 
    ['running', 'end'].includes(toolResult.stage);
  
  return (
    <Box flexDirection="column">
      {/* Existing tool result display */}
      
      {showDiff && (
        <Box flexDirection="column">
          {isExpanded ? 
            <ExpandedDiffView changes={changes} /> :
            <CollapsedDiffView changes={changes} />
          }
        </Box>
      )}
    </Box>
  );
}
```

### Package Dependencies
- **agent-sdk**: Export transformation function and Change interface
- **code package**: Import agent-sdk function, handle UI rendering
- **Diff library**: Move dependency from agent-sdk to code package for rendering

## Validation Requirements

### Function Contract Validation
- ✅ Write tool returns single Change with empty oldContent and content as newContent
- ✅ Edit tool returns single Change with old_string as oldContent and new_string as newContent
- ✅ MultiEdit tool returns multiple Changes from edits array with respective old/new content
- ✅ Unsupported tools return empty array
- ✅ Invalid parameters handled gracefully

### UI Contract Validation  
- ✅ Diff renders in both collapsed and expanded states
- ✅ Color scheme matches DiffViewer.tsx
- ✅ No truncation/pagination applied
- ✅ Graceful degradation for empty/invalid changes
- ✅ Integration with existing ToolResultDisplay layout