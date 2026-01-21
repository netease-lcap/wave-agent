# Data Model: Subagent Support

## Core Entities

### SubagentConfiguration
Represents a subagent definition loaded from filesystem configuration.

**Fields**:
- `name: string` - Unique identifier (lowercase, hyphens only)
- `description: string` - Natural language description for task matching
- `tools?: string[]` - Optional tool restrictions (inherits all if undefined)
- `model?: string` - Optional model override (sonnet, opus, haiku, or 'inherit')
- `systemPrompt: string` - Markdown content from file body
- `filePath: string` - Source file path for debugging
- `scope: 'project' | 'user'` - Configuration scope
- `priority: number` - Computed priority (project=1, user=2)

**Validation Rules**:
- Name must match pattern: `^[a-z][a-z0-9-]*$`
- Description required and non-empty
- Tools must exist in available tool registry
- Model must be valid alias or 'inherit'
- SystemPrompt required and non-empty

**State Transitions**: Static configuration, no state changes

### SubagentInstance
Represents an active subagent handling a specific task.

**Fields**:
- `subagentId: string` - Unique subagent identifier (UUID)
- `configuration: SubagentConfiguration` - Configuration reference
- `aiManager: AiManager` - Isolated AI manager instance
- `messageManager: MessageManager` - Isolated message manager instance
- `status: 'initializing' | 'active' | 'completed' | 'error'` - Current state
- `messages: Message[]` - Subagent conversation history

**Validation Rules**:
- SubagentId must be valid UUID v4
- Status transitions: initializing → active → (completed | error)
- Messages array maintains chronological order
- CreatedAt cannot be future date

**State Transitions**:
```
initializing → active (when aiManager ready)
active → completed (when task finished successfully)  
active → error (when task failed)
(completed | error) → [destroyed] (when session ends)
```

### TaskDelegation
Represents the input parameters for task delegation via the Task tool.

**Fields**:
- `description: string` - A short (3-5 word) description of the task
- `prompt: string` - The task for the agent to perform
- `subagent_type: string` - The type of specialized agent to use for this task

**Validation Rules**:
- Description required and non-empty (3-5 words)
- Prompt required and non-empty
- Subagent_type required and non-empty

**State Transitions**: Immutable input parameters, no state changes

### SubagentBlock
UI representation of subagent activity within message list.

**Fields**:
- `type: 'subagent'` - Block type identifier
- `subagentId: string` - Reference to SubagentInstance
- `subagentName: string` - Display name from configuration
- `messages: Message[]` - Cached message subset for display
- `status: 'active' | 'completed' | 'error'` - Current status


**Validation Rules**:
- SubagentId must reference valid SubagentInstance
- SubagentName must match configuration
- Messages array limited to 10 most recent when expanded, 2 when collapsed
- Status must match associated SubagentInstance status

**State Transitions**:
```
created → active (when subagent starts processing)
active → completed (when subagent finishes)
active → error (when subagent fails)
```

**Note**: UI expansion state (`isExpanded`) is managed by React component state/context, not stored in the block data.

## Relationships

### Configuration → Instance (1:N)
- One SubagentConfiguration can create multiple SubagentInstances
- Each SubagentInstance references exactly one SubagentConfiguration
- Instance lifecycle independent of configuration changes

### Instance → Block (1:1)
- Each SubagentInstance has exactly one SubagentBlock representation
- SubagentBlock lifecycle tied to SubagentInstance
- Block destroyed when instance destroyed

### TaskDelegation → Instance (1:1)
- Each TaskDelegation input creates at most one SubagentInstance
- Failed delegations create no instances
- Successful delegations create exactly one instance

## Storage

### File-based Configuration
**Location**: `.wave/agents/` (project) and `~/.wave/agents/` (user)
**Format**: Markdown files with YAML frontmatter
**Structure**:
```yaml
---
name: subagent-name
description: "Task expertise description"
tools: ["Read", "Write", "Bash"]  # optional
model: "sonnet"  # optional
---
System prompt content in markdown format.
Multiple paragraphs supported.
```

**Access Pattern**:
- Load configurations on-demand when subagent selection needed
- Parse YAML frontmatter using gray-matter or similar
- Project configs override user configs by name
- No caching or file watching for simplicity

### Memory-based State
**SubagentInstances**: Map<subagentId, SubagentInstance>
**TaskDelegation**: Input parameters only (no persistent state)

**Lifecycle Management**:
- Load configurations on-demand from filesystem
- Create instances on task delegation
- Cache instances for session duration
- Clean up on main session end
- Persist message history through instance lifecycle

## Data Flow

### Configuration Loading
```
File System → On-demand YAML Parser → Validation → Ready for Use
```

### Task Delegation
```
Task Tool Input → Subagent Selection → Instance Creation → UI Block Creation
```

### Message Flow
```
Subagent Message → Instance MessageManager → Block Update → UI Rerender
```

### Cleanup Flow
```
Session End → Instance Destruction → Block Removal → Resource Cleanup
```