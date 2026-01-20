# Data Model: Diff Display UX Refinement

**Feature**: 030-diff-display-ux-refinement  
**Date**: 2025-12-11

## Entities

### ToolResult (Existing - No Changes)
Core entity representing tool execution results, used as-is without extension.

**Existing Fields**:
- `id`: string - Unique identifier for the tool execution
- `toolName`: string - Name of the executed tool (Write, Edit, MultiEdit)
- `status`: 'running' | 'completed' | 'error' - Current execution state
- `parameters`: Record<string, any> - Tool-specific input parameters
- `result`: string - Tool execution output/result

**Usage for Diff Display**:
- Diff information derived from `toolName` and `parameters` on-demand
- No interface changes required
- Transformation handled by agent-sdk exported function

### Change (NEW - in agent-sdk)
Simplified diff change representation exported by agent-sdk:
```typescript
interface Change {
  oldContent: string;
  newContent: string;
}
```

**Usage Pattern**:
- **Additions**: `oldContent: ""`, `newContent: "actual content"`
- **Deletions**: `oldContent: "actual content"`, `newContent: ""`
- **Modifications**: `oldContent: "original"`, `newContent: "updated"`

## Transformation Architecture

### Agent-SDK Exported Function
The agent-sdk exports a transformation function to convert tool parameters into standardized Change[] arrays. The UI layer uses this via the `DiffDisplay` component.

```typescript
// In packages/code/src/utils/toolParameterTransforms.ts
export function transformToolBlockToChanges(toolName: string, parameters: string): Change[]
```

**Function Responsibilities**:
- Encapsulate tool parameter knowledge within agent-sdk
- Provide clean interface for UI layer
- Handle tool-specific diff logic
- Return standardized Change[] format

### Parameter-to-Change Mapping

**Write Tool Processing**:
```typescript
case 'Write':
  return [{
    oldContent: "",  // No previous content
    newContent: parameters.content
  }];
```

**Edit Tool Processing**:
```typescript
case 'Edit':
  return [{
    oldContent: parameters.old_string,
    newContent: parameters.new_string
  }];
```

**MultiEdit Tool Processing**:
```typescript
case 'MultiEdit':
  return parameters.edits.map(edit => ({
    oldContent: edit.old_string,
    newContent: edit.new_string
  }));
```

## Display Format Structure

### Collapsed State Data
Generate summary information from Change[] array:
```typescript
interface CollapsedDiffData {
  filePath: string;
  totalAdditions: number;
  totalDeletions: number;
  changeCount: number;
}
```

### Expanded State Data  
Render Change[] array as unified diff format:
```typescript
interface DiffDisplayLine {
  type: 'addition' | 'deletion' | 'context';
  content: string;
  prefix: string; // '+', '-', or '  '
}
```

## Implementation Approach

### Clean Separation of Concerns
- **Agent-SDK**: Tool parameter knowledge and transformation logic
- **UI Layer**: Rendering and display logic only
- **No Interface Changes**: Existing ToolResult interface unchanged

### Component-Level Usage
`DiffDisplay` component usage:
```typescript
import { DiffDisplay } from './DiffDisplay.js';

// In ToolResultDisplay.tsx (only for stage === "end")
<DiffDisplay toolName={name} parameters={parameters} />

// In Confirmation.tsx
<DiffDisplay toolName={toolName} parameters={JSON.stringify(toolInput)} />
```

### Relationships

```
ToolResult (existing) ──transform──→ Change[] ──render──→ Diff Display
     ↑                                    ↑                    ↑
agent-sdk function              UI component logic      Visual output
```

**Benefits**: 
- Tool logic stays in agent-sdk
- UI layer doesn't need tool parameter knowledge
- Standardized Change[] interface
- Easy to test and maintain

## Usage Patterns

### Transform and Render (Within DiffDisplay)
```typescript
function DiffDisplay({ toolName, parameters }: Props) {
  const changes = useMemo(() => 
    transformToolBlockToChanges(toolName, parameters), 
    [toolName, parameters]
  );
  
  return renderExpandedDiff(changes);
}
```

### Color Preservation (Matching DiffViewer.tsx)
```typescript
import { diffLines, diffWords } from 'diff';

function renderDiffDisplay(change: Change): ReactNode {
  // Generate line-by-line diff using diffLines
  const lineDiffs = diffLines(change.oldContent, change.newContent);
  
  return lineDiffs.map((part, index) => {
    if (part.added) {
      return part.value.split('\n').filter(line => line).map((line, lineIndex) => (
        <Text key={`add-${index}-${lineIndex}`} color="green">+{line}</Text>
      ));
    } else if (part.removed) {
      return part.value.split('\n').filter(line => line).map((line, lineIndex) => (
        <Text key={`remove-${index}-${lineIndex}`} color="red">-{line}</Text>
      ));
    } else {
      // Context lines - show unchanged content
      return part.value.split('\n').filter(line => line).map((line, lineIndex) => (
        <Text key={`context-${index}-${lineIndex}`} color="white"> {line}</Text>
      ));
    }
  });
}

// Word-level diff for line-by-line comparison (when old and new have similar structure)
function renderWordLevelDiff(oldLine: string, newLine: string) {
  const changes = diffWords(oldLine, newLine);
  
  const removedParts: React.ReactNode[] = [];
  const addedParts: React.ReactNode[] = [];

  changes.forEach((part, index) => {
    if (part.removed) {
      removedParts.push(
        <Text key={`removed-${index}`} color="black" backgroundColor="red">
          {part.value}
        </Text>
      );
    } else if (part.added) {
      addedParts.push(
        <Text key={`added-${index}`} color="black" backgroundColor="green">
          {part.value}
        </Text>
      );
    } else {
      // Unchanged parts
      removedParts.push(
        <Text key={`removed-unchanged-${index}`} color="red">
          {part.value}
        </Text>
      );
      addedParts.push(
        <Text key={`added-unchanged-${index}`} color="green">
          {part.value}
        </Text>
      );
    }
  });

  return { removedParts, addedParts };
}
```