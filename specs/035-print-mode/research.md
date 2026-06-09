# Research: Print Mode

## Decision: Suppress all subagent output in print mode
- **Rationale**: Claude Code's print mode (`claude -p`) only outputs the main agent's final response. Subagent messages (both regular Agent tool and forked background agents like memory extraction) are internal — their results return to the main agent as tool_result content and get incorporated into the final answer. Printing subagent internals (system prompts, file manifests, reasoning) produces noisy, unusable output.
- **Alternatives considered**:
    - Print subagent output with indentation: Rejected because subagent user messages contain massive system prompts (e.g., auto-memory extraction lists 200+ files) that pollute stdout and break piping.
    - Selective suppression (only forked agents): Rejected because regular Agent tool subagent output is also internal — the main agent summarizes and incorporates it. Printing it separately creates duplicate/conflicting output.

## Decision: Remove `onSubagentUserMessageAdded` callback entirely
- **Rationale**: This callback received `params.content` which contained the full subagent user message — including system prompts with instructions and file manifests. Dumping this to stdout was the primary source of the bug report.
- **Alternatives considered**:
    - Truncate content: Rejected because even truncated system prompts are noise, and truncation doesn't solve the fundamental problem of leaking internal instructions.
    - Check content length: Rejected because arbitrary length thresholds are fragile and still print unnecessary output.

## Decision: Remove `onSubagentAssistantContentUpdated` and `onSubagentAssistantReasoningUpdated` callbacks
- **Rationale**: Subagent streaming output (reasoning, content) is not useful in print mode. The main agent receives subagent results as tool_result and incorporates them in its own response. Printing subagent content separately creates confusing, interleaved output.
- **Alternatives considered**:
    - Keep reasoning only: Rejected because subagent reasoning is also internal and not user-facing.
    - Add a "verbose" flag for subagent output: Rejected as over-engineering; no user has requested this and it adds configuration complexity.

## Decision: Keep main agent tool block indicators
- **Rationale**: Showing `🔧 Agent Explore: <description>` for the main agent's tool calls provides useful progress feedback in print mode without leaking internals. This is a lightweight indicator, not subagent output.
- **Alternatives considered**:
    - Remove all tool indicators: Rejected because users benefit from knowing which tools the main agent is calling, especially for long-running operations.

## Integration Points
- `print-cli.ts`: Consumes `AgentCallbacks` — controls what gets printed to stdout.
- `AgentCallbacks` (agent-sdk): Interface defines optional subagent callbacks; omitting them is valid.
- `SubagentManager` (agent-sdk): Forwards subagent events via callbacks; if no callback is registered, events are silently ignored.
- `ForkedAgentManager` (agent-sdk): Runs background agents (auto-memory) through SubagentManager; events flow through the same callback path.
