# Research Phase: Subagent Support

## Task Tool Implementation

**Decision**: Implement Task tool following existing ToolPlugin interface pattern

**Rationale**: 
- Consistent with existing tool architecture (readTool, editTool, etc.)
- Leverages existing ToolResult interface for success/error handling
- Integrates seamlessly with current tool execution pipeline
- Supports the specified input schema with description, prompt, and subagent_type

**Alternatives considered**:
- Custom delegation system outside tool framework - rejected due to complexity
- Built-in agent method - rejected to maintain tool-based architecture consistency

## Subagent Context Isolation

**Decision**: Create separate aiManager and messageManager instances per subagent

**Rationale**:
- Complete context isolation as specified in requirements
- Each subagent maintains independent conversation history
- Isolated tool access and model configuration
- Clean session management per subagent
- Prevents context bleeding between agents

**Alternatives considered**:
- Shared aiManager with context switching - rejected due to potential context leaking
- Message filtering approach - rejected as insufficient for true isolation

## Message Display Architecture

**Decision**: Extend existing MessageBlock types with SubagentBlock

**Rationale**:
- Leverages existing message rendering pipeline
- Reuses ToolResultDisplay and DiffViewer components as specified
- Maintains consistency with other block types
- Supports expandable/collapsible behavior through React state

**Alternatives considered**:
- Separate message system - rejected due to UI complexity
- Inline message mixing - rejected due to user experience requirements

## YAML Configuration Parsing

**Decision**: Use built-in Node.js support for YAML parsing with gray-matter pattern, load on-demand

**Rationale**:
- Consistent with markdown + frontmatter pattern used elsewhere
- No additional dependencies required (existing projects use similar patterns)
- Simple on-demand loading when subagents are needed
- Supports both user-level (~/.wave/agents/) and project-level (.wave/agents/) configs
- Supports precedence rules (project over user)

**Alternatives considered**:
- JSON configuration - rejected to match specification requirements
- Custom parser - rejected due to maintenance overhead
- Directory watching/caching - rejected to keep implementation simple

## Subagent Selection Algorithm

**Decision**: Implement specificity-based matching algorithm

**Rationale**:
- Uses description length and keyword density for scoring
- Prioritizes subagents with "PROACTIVELY" keyword as specified
- Handles explicit invocation by name matching
- Falls back to main agent when no matches found

**Alternatives considered**:
- Simple keyword matching - rejected as insufficient for complex scenarios
- ML-based matching - rejected due to complexity and dependency overhead
- First-match approach - rejected due to poor user experience

## Message Manager Callbacks Extension

**Decision**: Extend MessageManagerCallbacks interface with subagent-specific callbacks

**Rationale**:
- onSubAgentBlockAdded for new subagent session creation
- onSubAgentBlockUpdated for message updates within subagent
- Maintains existing callback pattern consistency
- Enables UI reactivity for subagent state changes

**Alternatives considered**:
- Generic message callbacks - rejected due to lack of subagent context
- Event-based system - rejected to maintain existing patterns

## React Component Architecture

**Decision**: Create SubagentBlock component extending existing patterns

**Rationale**:
- Reuses ToolResultDisplay and DiffViewer as specified
- Implements expand/collapse with 2 messages preview / 10 messages expanded
- Distinctive border and header styling for visual differentiation
- No support for command_output, image, memory, custom_command blocks as specified

**Alternatives considered**:
- Modify existing MessageList directly - rejected due to component complexity
- Separate subagent UI - rejected due to integration requirements

## Error Handling Strategy

**Decision**: Return error messages to main agent via ToolResult interface

**Rationale**:
- Subagents implemented as tool calls returning success/error
- Main agent handles error presentation and recovery
- Maintains tool execution consistency
- Supports graceful degradation

**Alternatives considered**:
- Exception throwing - rejected due to poor user experience
- Silent failure - rejected due to debugging difficulties
- Retry mechanisms - rejected to keep initial implementation simple

## Performance Considerations

**Decision**: Lazy loading and session caching for subagent instances

**Rationale**:
- Create aiManager/messageManager only when subagent invoked
- Cache instances for session duration to avoid recreation overhead
- Clean up resources when main session ends
- Target <500ms for subagent selection and initialization

**Alternatives considered**:
- Eager initialization - rejected due to memory overhead
- Persistent caching - rejected due to configuration change handling complexity