# Quickstart: Built-in Subagent Integration

## Overview

This feature adds built-in subagents (starting with "Explore" agent) that are available immediately without configuration files.

## Key Changes

### Files Modified
- `packages/agent-sdk/src/utils/subagentParser.ts` - Extended to load built-ins
- `packages/agent-sdk/src/utils/builtinSubagents.ts` - **NEW** Built-in definitions

### Files Added  
- `packages/agent-sdk/tests/utils/builtinSubagents.test.ts` - **NEW** Test built-in loading

## Usage

Built-in subagents work identically to file-based subagents:

```typescript
// Task tool usage (no changes)
await taskTool.execute({
  description: "Explore codebase structure", 
  prompt: "Find all TypeScript interfaces",
  subagent_type: "Explore"
});
```

## Built-in Subagents Available

### Explore
- **Purpose**: Codebase exploration and file search specialist
- **Tools**: All tools except file modification tools (Read-only mode)
- **Model**: "fastModel" (uses parent's fast model for speed)
- **Use cases**: Finding files, searching code, analyzing structure

## Priority System

1. **Project subagents** (`.wave/agents/`) - Override anything
2. **User subagents** (`~/.wave/agents/`) - Override built-ins  
3. **Built-in subagents** - Available by default

Users can override "Explore" by creating their own subagent file with the same name.

## Testing

```bash
cd packages/agent-sdk
pnpm test builtinSubagents
pnpm test subagentParser
```

## Implementation Notes

- No breaking changes to existing APIs
- Built-ins use virtual file paths: `<builtin:${name}>`
- Tool filtering converts disallowedTools to allowedTools
- Graceful fallback if built-in loading fails