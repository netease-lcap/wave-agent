# Research: Built-in Subagent Support

## Integration Strategy

**Decision**: Extend existing `loadSubagentConfigurations()` function to include built-in definitions with priority 3 (lowest)

**Rationale**: 
- Reuses existing `SubagentConfiguration` interface without modifications
- Maintains backward compatibility with current SubagentManager
- Allows user/project configs to override built-ins by name
- Minimal code changes required

**Alternatives considered**:
- Separate loading mechanism: Rejected due to complexity and duplicate logic
- New interface for built-ins: Rejected to maintain consistency

## Priority System Extension

**Decision**: Add "builtin" scope with priority 3, keeping existing priorities unchanged

**Rationale**:
- Built-ins should have lowest priority (most overrideable)  
- Existing user (priority 2) and project (priority 1) precedence preserved
- Clear hierarchy: project > user > builtin

## Built-in Definition Format

**Decision**: Hardcode built-in subagents directly as `SubagentConfiguration` objects

**Rationale**:
- explore-agent.js is just a reference example, not a format to convert
- Direct hardcoding is simpler and more maintainable
- Provides virtual filePath for identification (`<builtin:${name}>`)
- Maintains standard interface compatibility

**Hardcoded format**:
- Name: "Explore" (matching the agentType from example)
- System prompt: Codebase exploration specialist prompt
- Tools: Specified allowed tools for read-only operations  
- Model: "fastModel" (special value to use parent's fastModel, similar to "inherit")
- Scope: New "builtin" scope type (type assertion required)

## Implementation Approach

**Decision**: Two-file approach - `builtinSubagents.ts` for definitions, extend `subagentParser.ts` for loading

**Rationale**:
- Clear separation of concerns
- Easy to add more built-in subagents
- Minimal changes to existing parser logic
- Testable in isolation