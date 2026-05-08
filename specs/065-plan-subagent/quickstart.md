# Quickstart: Plan Subagent

## Overview

The Plan subagent is a built-in software architect agent specialized for designing implementation plans. It explores codebases in read-only mode and produces detailed implementation strategies with critical files identified.

## Key Changes

### Files Modified
- `packages/agent-sdk/src/utils/builtinSubagents.ts` - Added Plan subagent definition
- `packages/agent-sdk/src/constants/prompts.ts` - Added PLAN_SUBAGENT_SYSTEM_PROMPT

### Files Added
- `packages/agent-sdk/tests/utils/builtinSubagents.test.ts` - Tests for Plan subagent

## Usage

The Plan subagent works identically to other built-in subagents and can be invoked via the Task tool:

```typescript
// Task tool usage
await taskTool.execute({
  description: "Design implementation plan for adding user authentication",
  prompt: "Explore the codebase and design a plan for adding JWT-based authentication",
  subagent_type: "Plan"
});
```

## Built-in Subagent: Plan

### Purpose
Software architect agent for designing implementation plans without making code changes.

### Capabilities
- **Read-only exploration**: Uses Glob, Grep, Read, LSP, and read-only Bash commands
- **Implementation planning**: Designs step-by-step implementation strategies
- **Critical file identification**: Identifies 3-5 most critical files for implementation
- **Architectural analysis**: Considers trade-offs and design patterns

### Tools Available
- **Glob**: File pattern matching
- **Grep**: Content search with regex
- **Read**: Reading file contents
- **Bash (read-only)**: ls, git status, git log, git diff, find, cat, head, tail
- **LSP**: Code intelligence (definitions, references, symbols)

### Tools Restricted
- **Write**: Cannot create new files
- **Edit**: Cannot modify existing files
- **NotebookEdit**: Cannot modify notebooks
- **Task**: Cannot spawn nested subagents
- **Bash (write operations)**: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install

### Model
Uses "inherit" to match the parent agent's model choice for consistent quality.

## Use Cases

### 1. Planning Complex Features
```typescript
{
  subagent_type: "Plan",
  prompt: "Design a plan for adding real-time notifications using WebSockets. Include integration points with existing authentication and API layers."
}
```

### 2. Refactoring Strategy
```typescript
{
  subagent_type: "Plan",
  prompt: "Explore the current database layer and design a migration plan to switch from raw SQL queries to an ORM. Identify all files that need changes."
}
```

### 3. Multiple Planning Perspectives
```typescript
// Spawn multiple Plan subagents with different perspectives
await Promise.all([
  taskTool.execute({
    subagent_type: "Plan",
    prompt: "Design a plan focusing on simplicity and maintainability"
  }),
  taskTool.execute({
    subagent_type: "Plan",
    prompt: "Design a plan focusing on performance and scalability"
  })
]);
```

## Output Format

Plan subagent produces structured output including:

1. **Understanding**: Summary of requirements and existing code
2. **Implementation Strategy**: Step-by-step approach
3. **Critical Files**: 3-5 most important files with paths and reasons
4. **Considerations**: Trade-offs, risks, and architectural decisions

## Priority System

Built-in subagents can be overridden:

1. **Project subagents** (`.wave/agents/`) - Override anything
2. **User subagents** (`~/.wave/agents/`) - Override built-ins
3. **Built-in subagents** - Available by default

Users can override "Plan" by creating their own subagent file with the same name.

## Testing

```bash
cd packages/agent-sdk
pnpm test builtinSubagents
pnpm test subagentParser
```

## Integration with Plan Mode

The Plan subagent is designed to work within plan mode workflows:

```
Plan Mode Phase 1: Initial Understanding
└─> Spawn Explore agents (parallel)

Plan Mode Phase 2: Design
└─> Spawn Plan agents (parallel) ← Plan subagent used here
    └─> Explore codebase with read-only tools
    └─> Design implementation approach
    └─> Output plan with critical files

Plan Mode Phase 3: Review
└─> User reviews plans from Phase 2
```

## Implementation Notes

- No breaking changes to existing APIs
- Built-ins use virtual file paths: `<builtin:Plan>`
- Tool filtering ensures only read-only operations are available
- System prompt emphasizes read-only restrictions and planning focus
- Critical reminder in prompt prevents accidental file modifications
