# Quickstart: Diff Display UX Refinement

**Feature**: 030-diff-display-ux-refinement  
**Goal**: Consolidate diff display functionality into ToolResultDisplay component with unlimited display

## Implementation Overview

This feature removes the separate DiffViewer component and consolidates diff display directly into ToolResultDisplay using case-by-case parameter transformation. No interface changes to agent-sdk required.

### Key Changes

1. **Remove Components**
   - Delete `packages/code/src/components/DiffViewer.tsx`
   - Remove diff rendering from `packages/code/src/components/MessageItem.tsx`

2. **NO Interface Extensions**
   - Keep existing ToolBlock interface unchanged
   - No agent-sdk modifications required
   - All logic contained within ToolResultDisplay component

3. **Enhance ToolResultDisplay**
   - Add diff display logic to `packages/code/src/components/ToolResultDisplay.tsx`
   - Implement tool detection (Write/Edit/MultiEdit) by toolName
   - Transform parameters to diff content on-demand
   - Use exact DiffViewer.tsx color scheme

## Quick Implementation Steps

### Phase 1: Dependency Management
```bash
# Remove diff dependency from agent-sdk
cd packages/agent-sdk
# Remove diff package from package.json dependencies
# Rebuild agent-sdk to ensure no diff dependencies remain
pnpm build

# Add diff dependency to code package  
cd packages/code
pnpm add diff
pnpm add @types/diff --save-dev
```

### Phase 2: Component Logic
```bash
# Continue in code package
cd packages/code

# Modify src/components/ToolResultDisplay.tsx to include:
# 1. Import diff library (now local dependency)
# 2. Tool detection logic (toolName === 'Write'/'Edit'/'MultiEdit')  
# 3. Parameter extraction from block.parameters
# 4. On-demand diff generation using diff library
# 5. DiffViewer.tsx color scheme replication

# Remove diff logic from src/components/MessageItem.tsx
# Delete src/components/DiffViewer.tsx
```

### Phase 3: Testing (Single Package)
```bash
# Test the changes in code package only
cd packages/code
pnpm run type-check
pnpm lint
pnpm test
```

### Dependency Benefits
- diff library only where it's used (code package)
- agent-sdk becomes cleaner with fewer dependencies
- No cross-package diff imports needed
- Faster agent-sdk build times

## Expected Behavior

### Before (Current)
- Diffs displayed in separate DiffViewer component
- Shown in message items when `block.type === "diff"`
- Separate diff rendering logic

### After (Target)  
- Diffs displayed within ToolResultDisplay component
- Shown based on tool parameters and execution state
- Unlimited diff display (no truncation or limits)
- Exact visual match to current DiffViewer colors

### Tool-Specific Diff Display

**Write Tool**: Shows content parameter as new additions
```
📄 /path/to/file.txt [A] +25 lines
+ line 1 of content
+ line 2 of content  
+ ...all content lines
```

**Edit Tool**: Shows old_string → new_string replacement  
```
📄 /path/to/file.txt [M] +1 -1 lines
- old_string content
+ new_string content
```

**MultiEdit Tool**: Shows each edit pair from edits array
```
📄 /path/to/file.txt [M] +5 -3 lines (3 edits)
- first old_string
+ first new_string
- second old_string  
+ second new_string
- third old_string
+ third new_string
```

## Color Scheme (Match DiffViewer.tsx Exactly)

- **Line-level additions**: `color="green"` 
- **Line-level deletions**: `color="red"`
- **Word-level additions**: `color="black" backgroundColor="green"`
- **Word-level deletions**: `color="black" backgroundColor="red"`
- **Context lines**: `color="white"`
- **Separators**: `color="gray" dimColor={true}`
- **No changes message**: `color="gray"`

## Validation Checklist

- [ ] DiffViewer.tsx deleted
- [ ] MessageItem.tsx no longer renders diffs
- [ ] ToolResultDisplay renders diffs in both collapsed and expanded states
- [ ] Tool parameters correctly mapped to diff display (Write/Edit/MultiEdit)
- [ ] Unlimited diff display (no line limits or truncation)
- [ ] Exact color scheme match to original DiffViewer
- [ ] No agent-sdk interface changes
- [ ] All tests pass
- [ ] Type checking passes
- [ ] Linting passes

## File Changes Summary

**Modified Files**:
- `packages/agent-sdk/package.json` - Remove diff dependency
- `packages/code/package.json` - Add diff and @types/diff dependencies  
- `packages/code/src/components/ToolResultDisplay.tsx` - Add diff display logic with local diff import
- `packages/code/src/components/MessageItem.tsx` - Remove diff rendering

**Deleted Files**:
- `packages/code/src/components/DiffViewer.tsx` - Consolidated into ToolResultDisplay

**Updated Test Files**:
- `packages/code/tests/components/ToolResultDisplay.test.tsx` - Test diff display functionality

**Package Changes**:
- agent-sdk: Remove diff package dependency (cleaner, fewer deps)
- code: Add diff package dependency (where it's actually used)