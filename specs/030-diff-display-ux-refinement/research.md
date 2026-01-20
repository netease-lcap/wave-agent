# Research: Diff Display UX Refinement

**Date**: 2025-12-11  
**Feature**: 030-diff-display-ux-refinement

## Performance Requirements

### Decision: Unlimited diff display for simplicity
- **All states**: No line limits, show complete diff content
- **No pagination**: Keep implementation simple, display everything inline
- **No truncation**: Users can scroll if needed, maintain full visibility

### Rationale: Prioritizing simplicity over optimization
User feedback indicates preference for unlimited display to avoid complexity. Terminal scrolling handles large content naturally. Simplicity reduces maintenance burden and edge cases.

### Alternatives considered:
- **Progressive limits (10-20, 200-500 lines)**: Rejected for being too complex
- **Pagination strategies**: Rejected to maintain simplicity
- **Performance optimization**: Deferred in favor of straightforward implementation

## Visual Space Constraints

### Decision: Collapsed shows summary, expanded shows unlimited full diff
- **Collapsed state**: File name, status indicator, quantitative summary (+X -Y lines)  
- **Expanded state**: Complete diff content without limits
- **Consistent**: Both states show essential identifying information

### Rationale: Following existing ToolResultDisplay patterns
Analysis of existing `ToolResultDisplay.tsx` shows clear collapsed/expanded patterns. Unlimited expanded view maintains complete information access while collapsed provides quick overview.

### Alternatives considered:
- **Same content in both states**: Rejected as it defeats collapsed/expanded purpose
- **Limited expanded view**: Rejected per user feedback for simplicity
- **Multiple expansion levels**: Rejected as unnecessarily complex

## Scale and Scope Approach

### Decision: No limits, handle all diff sizes uniformly
- **All diffs**: Display completely regardless of size
- **No fallbacks**: Eliminate "too large" messages or external viewers
- **Simple scrolling**: Let terminal handle large content navigation

### Rationale: Maximum simplicity and predictability
Users prefer consistent behavior over complex adaptive logic. Terminal applications handle large text content well with native scrolling capabilities.

### Alternatives considered:
- **Size-based progressive disclosure**: Rejected for complexity
- **External viewer fallbacks**: Rejected to keep everything inline
- **Performance-based limits**: Rejected in favor of simplicity

## Implementation Patterns

### Decision: Case-by-case parameter transformation with local diff dependency
- **No interface changes**: Avoid extending ToolBlock or agent-sdk modifications
- **Direct transformation**: Convert tool parameters to diff display within ToolResultDisplay component
- **Tool type detection**: Use existing tool name/parameters to determine diff logic
- **Local diff import**: Move diff library from agent-sdk to code package

### Rationale: Minimal code changes and proper dependency isolation
Keeps changes isolated to single component. No SDK rebuild required for interface changes. Reduces complexity and maintains existing interfaces. diff library only installed where it's used.

### Alternatives considered:
- **ToolBlock interface extension**: Rejected to avoid SDK changes
- **Separate diff service**: Rejected for being over-engineered
- **Global diff state management**: Rejected as unnecessarily complex
- **Keep diff in agent-sdk**: Rejected to improve package separation and reduce SDK dependencies

## Color and Formatting Standards

### Decision: Exact match to existing DiffViewer.tsx color scheme
- **Additions**: Green (`color="green"`) for line-level, black text on green background for word-level
- **Deletions**: Red (`color="red"`) for line-level, black text on red background for word-level  
- **Context**: White (`color="white"`) for unchanged lines
- **Separators**: Gray (`color="gray"`) with `dimColor={true}` for "..." indicators
- **No changes**: Gray (`color="gray"`) for "No changes detected" message

### Rationale: Maintain visual consistency with existing implementation
Users expect consistent visual experience. Reusing exact color scheme ensures no visual regression when consolidating components.

### Alternatives considered:
- **Standard CLI colors**: Rejected to maintain existing visual identity
- **Simplified color scheme**: Rejected to preserve current user experience
- **Enhanced colors**: Rejected to avoid unnecessary changes during consolidation