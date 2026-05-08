# Research: General-Purpose Agent

## Decision: Implementation of `general-purpose` subagent

### Rationale
The `general-purpose` subagent is designed to handle complex, multi-step tasks that require both deep research and the ability to modify files. This complements the existing `Explore` subagent, which is optimized for fast, read-only exploration. By providing a built-in `general-purpose` agent with full tool access (`*`), we enable the main agent to delegate implementation-heavy tasks effectively.

### Alternatives considered
- **Extending `Explore` agent**: Rejected because `Explore` is explicitly designed to be read-only and fast. Adding write capabilities would compromise its safety profile and performance goals.
- **Dynamic subagent creation**: Rejected because having a well-defined, built-in subagent provides a more predictable and reliable experience for common delegation patterns.

## Decision: System Prompt and Guidelines

### Rationale
The system prompt for the `general-purpose` agent will be based on the user-provided description, emphasizing its strengths in codebase research, architectural analysis, and multi-step tasks. It will explicitly include guidelines for absolute paths, no proactive documentation, and no emojis to ensure consistency with the Wave Agent Constitution.

### Alternatives considered
- **Minimal prompt**: Rejected because a detailed prompt is necessary to guide the LLM in complex research and implementation scenarios.

## Decision: Integration Point

### Rationale
The agent will be registered in `packages/agent-sdk/src/utils/builtinSubagents.ts` within the `getBuiltinSubagents` function. This is the established pattern for built-in subagents in the monorepo.

### Alternatives considered
- **Separate package**: Rejected to avoid unnecessary package proliferation and maintain the "Package-First Architecture" principle by keeping core SDK logic together.
