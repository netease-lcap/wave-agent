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
- `toolManager: ToolManager` - Isolated tool manager instance
- `status: 'initializing' | 'active' | 'completed' | 'error' | 'aborted'` - Current state
- `messages: Message[]` - Subagent conversation history
- `lastTools: string[]` - Tracking the last executed tools for reporting

**Validation Rules**:
- SubagentId must be valid UUID v4
- Status transitions: initializing → active → (completed | error | aborted)
- Messages array maintains chronological order

**State Transitions**:
```
initializing → active (when aiManager ready)
active → completed (when task finished successfully)  
active → error (when task failed)
active → aborted (when task was cancelled)
(completed | error | aborted) → [destroyed] (after result is returned to main agent)
```

### AgentToolCall
Represents the tool call through which subagents are invoked.

**Fields**:
- `description: string` - A short (3-5 word) description of the task
- `prompt: string` - The task for the agent to perform
- `subagent_type: string` - The type of specialized agent to use for this task
- `run_in_background: boolean` - Whether to run the subagent in the background

**Validation Rules**:
- Description required and non-empty
- Prompt required and non-empty
- Subagent_type required and non-empty

## Relationships

### Configuration → Instance (1:N)
- One SubagentConfiguration can create multiple SubagentInstances
- Each SubagentInstance references exactly one SubagentConfiguration
- Instance lifecycle is tied to the tool execution

### Instance → AgentToolResult (1:1)
- Each SubagentInstance produces exactly one result returned to the main agent
- The result includes the final assistant message and a summary in `shortResult`

## Storage

### File-based Configuration
**Location**: `.wave/agents/` (project) and `~/.wave/agents/` (user)
**Format**: Markdown files with YAML frontmatter

**Access Pattern**:
- Load configurations on-demand when subagent selection needed
- Project configs override user configs by name

### Memory-based State
**SubagentInstances**: Map<subagentId, SubagentInstance> in `SubagentManager`

**Lifecycle Management**:
- Create instances on task delegation
- Subagent instances are temporary and isolated
- Active instances are cleaned up via `cleanupInstance(subagentId)` immediately after the tool execution completes

## Data Flow

### Configuration Loading
```
File System → On-demand YAML Parser → Validation → Ready for Use
```

### Task Delegation
```
Agent Tool Input → Subagent Selection → Instance Creation → AIManager Execution
```

### Activity Reporting
```
Subagent Event → Callback → Agent Tool `onShortResultUpdate` → UI ToolBlock Rerender
```

### Cleanup Flow
```
Task Completion → Result Returned → cleanupInstance(subagentId) → Resource Destruction
```