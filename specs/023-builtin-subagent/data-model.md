# Data Model: Built-in Subagent Support

## Core Entities

### SubagentConfiguration (Extended)
Existing interface with new scope value for built-in subagents.

**Fields**:
- `name: string` - Subagent identifier (e.g., "Explore")
- `description: string` - Human-readable description  
- `systemPrompt: string` - Agent instructions
- `tools?: string[]` - Allowed tools (converted from disallowedTools)
- `model?: string` - Preferred model ("fastModel" for Explore agent - uses parent's fastModel)
- `filePath: string` - Virtual path for built-ins (`<builtin:${name}>`)
- `scope: "project" | "user" | "builtin"` - Source type (extended)
- `priority: number` - Loading precedence (3 for built-ins)

**Validation**:
- Name must match agentType from source definition
- SystemPrompt must be non-empty string
- Tools array validated against available tools
- Virtual filePath format: `<builtin:${name}>`

## Data Flow

```
Hardcoded definitions → SubagentConfiguration → SubagentManager
```

1. **Load**: Get hardcoded SubagentConfiguration objects from builtinSubagents.ts
2. **Merge**: Include in standard subagent loading with existing configs  
3. **Use**: SubagentManager handles identically to file-based subagents

## Priority System

**Precedence Order** (1 = highest priority):
1. Project subagents (`{workdir}/.wave/agents/`)  
2. User subagents (`~/.wave/agents/`)
3. Built-in subagents (hardcoded in source)

**Conflict Resolution**: Later priority overwrites earlier by name in Map.