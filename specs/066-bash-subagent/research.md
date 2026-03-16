# Research: Bash Builtin Subagent

## Decision: Subagent Registration
The Bash subagent will be implemented as a built-in subagent in `packages/agent-sdk`.

- **Location**: `packages/agent-sdk/src/utils/builtinSubagents.ts`
- **Prompt Storage**: `packages/agent-sdk/src/constants/prompts.ts`
- **Tools**: Will use `BASH_TOOL_NAME` (which maps to the "Bash" tool).
- **Model**: Will use `"inherit"` to match the reference implementation and ensure it uses the same model as the main agent.

## Rationale
Following the existing pattern for `Explore` and `Plan` subagents ensures consistency and leverages the existing subagent management infrastructure. Storing the prompt in `constants/prompts.ts` maintains a clean separation between configuration and content.

## Alternatives Considered
- **Defining prompt inline**: While done for the `Explore` subagent, it's less maintainable for longer prompts.
- **Custom tool set**: The reference implementation specifically uses the bash execution tool, which is already available as `BASH_TOOL_NAME`.

## Technical Context
- **Subagent Name**: "Bash"
- **Agent Type**: `Bash` (to be added to `SubagentType` if not present)
- **System Prompt**: Derived from `bash-agent.tmp.js`.
- **Tools**: `BASH_TOOL_NAME`.
- **Source**: `built-in`.
