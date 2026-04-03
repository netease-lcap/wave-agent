# Research Phase: Subagent Support

## Agent Tool Implementation

**Decision**: Implement `Agent` tool following existing `ToolPlugin` interface pattern

**Rationale**: 
- Consistent with existing tool architecture (Read, Edit, etc.)
- Leverages existing `ToolResult` interface for success/error handling
- Integrates seamlessly with current tool execution pipeline
- Supports the specified input schema with description, prompt, and subagent_type

## Subagent Context Isolation

**Decision**: Create separate `AIManager` and `MessageManager` instances per subagent

**Rationale**:
- Complete context isolation as specified in requirements
- Each subagent maintains independent conversation history
- Isolated tool access and model configuration
- Clean session management per subagent
- Prevents context bleeding between agents

## Message Display Architecture

**Decision**: Use standard `ToolDisplay` to show subagent activity via `shortResult`

**Rationale**:
- Integrated into the main conversation flow
- Reuses existing `ToolDisplay` component
- Provides real-time updates through `onShortResultUpdate` callback
- Prevents UI clutter and OOM issues by not persisting full subagent history in CLI memory

**Alternatives considered**:
- `SubagentBlock` custom component - rejected in favor of tool-based integration for better UX and performance.

## YAML Configuration Parsing

**Decision**: Use built-in Node.js support for YAML parsing with gray-matter pattern, load on-demand

**Rationale**:
- Consistent with markdown + frontmatter pattern used elsewhere
- Simple on-demand loading when subagents are needed
- Supports both user-level (~/.wave/agents/) and project-level (.wave/agents/) configs

## Subagent Selection Algorithm

**Decision**: Exact name matching via `Agent` tool's `subagent_type` parameter

**Rationale**:
- The LLM chooses the correct `subagent_type` based on descriptions provided in the tool prompt.
- SDK implements exact name matching only via `findSubagentByName()`.
- Predictable behavior and clear error messages when no match is found.

## Subagent Manager Callbacks

**Decision**: Create dedicated `SubagentManagerCallbacks` interface

**Rationale**: 
- Cleaner architectural separation between `MessageManager` and `SubagentManager`.
- Primary use in CLI is to update the `shortResult` of the `Agent` tool block.
- `AgentCallbacks` extends `SubagentManagerCallbacks` for end-to-end integration.

## Cleanup Strategy

**Decision**: Immediate cleanup of subagent instances after task completion

**Rationale**:
- Protects against OOM issues in long-running CLI sessions.
- Subagent instances are temporary and their resources (AI/Message managers) are released immediately after returning results.
- `subagentManager.cleanupInstance(subagentId)` is called by the `Agent` tool.

## Error Handling Strategy

**Decision**: Return error messages to main agent via `ToolResult` interface

**Rationale**:
- Subagents implemented as tool calls returning success/error.
- Main agent handles error presentation and recovery.
- Maintains tool execution consistency.
