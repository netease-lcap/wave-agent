# Data Model: Plan Subagent Support

## Entities

### PlanSubagentDefinition
Built-in subagent configuration for the Plan agent.

**Fields**:
- `name`: "Plan" (string)
- `description`: Description of when to use Plan subagent (string)
- `systemPrompt`: The Plan subagent system prompt (string)
- `tools`: Array of allowed tools (["Glob", "Grep", "Read", "Bash", "LS", "LSP"])
- `model`: "inherit" - uses parent agent's model (string)
- `filePath`: "<builtin:Plan>" - virtual file path (string)
- `scope`: "builtin" - indicates built-in subagent (string)
- `priority`: 3 - lowest priority, can be overridden (number)

### PlanSubagentSystemPrompt
Multi-part prompt template that guides the Plan subagent's behavior.

**Sections**:
1. **Role Definition**: Software architect and planning specialist role
2. **Critical Read-Only Restrictions**: Emphasizes no file modifications allowed
3. **Process Workflow**:
   - Understand requirements
   - Explore thoroughly
   - Design solution
   - Detail plan
4. **Output Format Requirements**:
   - Understanding section
   - Implementation strategy
   - Critical files (3-5 files with paths and reasons)
   - Considerations
5. **Tool Usage Guidance**: Instructions for using read-only tools
6. **Prohibitions**: Explicit list of forbidden operations

## Tool Access Matrix

| Tool Category | Access | Notes |
|--------------|--------|-------|
| Read | ✓ | Full access to read files |
| Glob | ✓ | Full access for file pattern matching |
| Grep | ✓ | Full access for content search |
| LSP | ✓ | Language server protocol for code intelligence |
| Bash (read-only) | ✓ | ls, git status, git log, git diff, find, cat, head, tail |
| Bash (write) | ✗ | mkdir, touch, rm, cp, mv, git add, git commit, npm install |
| Write | ✗ | Blocked - cannot create files |
| Edit | ✗ | Blocked - cannot modify files |
| NotebookEdit | ✗ | Blocked - cannot modify notebooks |
| Task | ✗ | Cannot spawn nested subagents |

## Integration Points

### SubagentManager
- Registers Plan as a built-in subagent alongside Explore and general-purpose
- Loads Plan subagent configuration from `builtinSubagents.ts`
- Applies priority system (project > user > built-in)

### Task Tool
- Lists Plan subagent in available agent types
- Provides description and "whenToUse" guidance
- Routes task to Plan subagent when `subagent_type: "Plan"` is specified

### Tool Filtering System
- Enforces read-only tool restrictions at runtime
- Validates tool calls against allowed tools list
- Provides clear error messages for prohibited operations
