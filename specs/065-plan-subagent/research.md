# Research: Plan Subagent Support

## Problem Statement

Users need a specialized agent for designing implementation plans that can explore codebases thoroughly without making any modifications. The Plan subagent must act as a software architect, analyzing code and producing detailed implementation strategies with critical files identified.

## Design Decisions

### 1. Built-in vs Custom Subagent

**Options Considered**:
- A. Require users to create their own Plan subagent configuration
- B. Provide Plan as a built-in subagent (SELECTED)

**Decision**: Built-in subagent (Option B)

**Rationale**:
- Plan mode is a core feature that benefits from a standard planning agent
- Users expect immediate access to planning capabilities without configuration
- Consistent planning behavior across all users
- Follows pattern of existing Explore built-in subagent
- Users can still override with custom configs if needed

### 2. Tool Restrictions

**Options Considered**:
- A. Allow all tools but enforce restrictions in system prompt only
- B. Restrict tools at configuration level (SELECTED)

**Decision**: Restrict tools at configuration level (Option B)

**Rationale**:
- Hard enforcement prevents accidental file modifications
- Tool filtering provides immediate error feedback
- System prompt guidance complements tool restrictions
- Aligns with existing Explore subagent pattern
- More reliable than prompt-based restrictions alone

### 3. Model Selection

**Options Considered**:
- A. Use "fastModel" like Explore subagent
- B. Use "inherit" to match parent agent's model (SELECTED)
- C. Hardcode to specific model like "opus-4"

**Decision**: Use "inherit" to match parent agent's model (Option B)

**Rationale**:
- Planning requires deep reasoning and architectural thinking
- Parent agent's model choice reflects user's quality preference
- Faster models may miss important architectural considerations
- Different from Explore (uses fastModel for speed) because planning is more critical
- Users get consistent quality level across planning and implementation

### 4. System Prompt Structure

**Options Considered**:
- A. Brief prompt focusing only on planning
- B. Comprehensive prompt with critical sections and explicit prohibitions (SELECTED)

**Decision**: Comprehensive prompt with critical sections (Option B)

**Rationale**:
- Clear role definition guides behavior
- Critical read-only section prevents accidental violations
- Process workflow provides structure for planning tasks
- Output format ensures consistent, useful results
- Explicit prohibitions reduce ambiguity
- Based on successful pattern from reference implementation

### 5. Critical Files Requirement

**Options Considered**:
- A. Optional critical files section
- B. Required critical files section (3-5 files) (SELECTED)

**Decision**: Required critical files section (Option B)

**Rationale**:
- Helps users understand scope of implementation
- Provides clear entry points for implementation phase
- Forces Plan subagent to identify most important changes
- Aids in estimating complexity and risk
- Makes plans more actionable

### 6. Multiple Perspectives Support

**Options Considered**:
- A. Single Plan subagent per session
- B. Support multiple Plan subagents with different perspectives (SELECTED)

**Decision**: Support multiple Plan subagents (Option B)

**Rationale**:
- Complex problems benefit from multiple approaches
- Users can compare simplicity vs performance trade-offs
- Existing subagent infrastructure already supports parallel execution
- No additional implementation cost
- Aligns with plan mode workflow design

### 7. Integration Point

**Options Considered**:
- A. Special plan mode API
- B. Standard Task tool invocation (SELECTED)

**Decision**: Standard Task tool invocation (Option B)

**Rationale**:
- Consistent with existing subagent patterns
- No special case handling required
- Works in plan mode and regular mode
- Simpler implementation
- Reuses existing infrastructure

## Technical Constraints

### Read-Only Enforcement
- Tool filtering at SubagentManager level
- System prompt reinforcement
- Clear error messages for violations

### Model Inheritance
- Must use "inherit" model value
- Resolved at runtime by SubagentManager
- Ensures consistent quality with parent agent

### Priority System
- Priority 3 (lowest) allows user override
- Project configs (priority 1) take precedence
- User configs (priority 2) take precedence
- Follows established pattern

## Alternative Approaches Rejected

### Approach: Single "Planning Mode" Instead of Subagent
**Rejected Because**:
- Less flexible than subagent approach
- Cannot spawn multiple perspectives
- Harder to integrate with existing plan mode
- Would require new permission mode
- Subagent pattern already established and working

### Approach: Allow Write Access to Plan File Only
**Rejected Because**:
- Adds complexity to tool filtering
- Plan subagent should focus on analysis, not writing
- Parent agent should consolidate plans
- Cleaner separation of concerns with pure read-only

### Approach: Separate Tools for Plan Subagent
**Rejected Because**:
- Existing tools (Glob, Grep, Read, LSP) sufficient
- Would duplicate functionality
- Unnecessary complexity
- Standard tools work well for exploration

## References

- Existing Explore built-in subagent implementation
- Plan mode workflow specification (specs/050-support-plan-mode/)
- Built-in subagent support specification (specs/025-builtin-subagent/)
- Reference implementation in plan.tmp.js
