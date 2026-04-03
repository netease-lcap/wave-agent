# Implementation Plan: Subagent Support

**Branch**: `009-subagent` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-subagent/spec.md`

## Summary

Implement subagent support system that allows Wave Agent to delegate specialized tasks to configured AI personalities. Subagents operate with isolated context windows, have configurable tool access, and report their activity through the `shortResult` of the `Agent` tool block in the UI. The system includes an `Agent` tool for delegation, isolated `AIManager` and `MessageManager` instances per subagent, and real-time progress reporting via callbacks.

## Technical Context

**Language/Version**: TypeScript with Node.js >=16.0.0  
**Primary Dependencies**: OpenAI SDK 5.12.2, React 19.1.0, Ink 6.0.1  
**Storage**: File-based configuration (.wave/agents/, ~/.wave/agents/) with YAML frontmatter  
**Performance Goals**: Subagent task completion within 150% of main agent time, <500ms for subagent selection  
**Constraints**: Context isolation between agents, no circular delegation, UI responsiveness during subagent execution  
**Scale/Scope**: Support for unlimited subagents per project, real-time activity reporting via tool `shortResult`

## Design Validation

✅ **I. Package-First Architecture**: Design maintains clear package boundaries. `SubagentManager` and `Agent` tool in `agent-sdk`, UI reporting in `code` package. No circular dependencies. Each subagent gets isolated `AIManager`/`MessageManager` instances.

✅ **II. TypeScript Excellence**: All new interfaces fully typed (`SubagentConfiguration`, `SubagentInstance`, `AgentToolCall`).

✅ **III. Build Dependencies**: `agent-sdk` must be built before `code` package can use the updated `Agent` tool and subagent managers.

✅ **IV. Resource Management**: Subagent instances are cleaned up immediately after task completion to prevent memory leaks and OOM issues in long-running CLI sessions.

## Project Structure

### Source Code

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── tools/
│   │   │   ├── agentTool.ts                   # NEW: Agent delegation tool
│   │   │   └── index.ts                       # EXTEND: Export agentTool
│   │   ├── managers/
│   │   │   ├── subagentManager.ts             # NEW: Subagent lifecycle & callbacks
│   │   │   ├── messageManager.ts              # EXTEND: Internal subagent history
│   │   │   └── aiManager.ts                   # EXTEND: Subagent AI execution
│   │   └── utils/
│   │       └── subagentParser.ts              # NEW: YAML config parsing
│   └── tests/
│       ├── tools/
│       │   └── agentTool.test.ts              # NEW: Agent tool tests
│       └── managers/
│           └── subagentManager.test.ts        # NEW: Subagent manager tests
└── code/
    ├── src/
    │   ├── components/
    │   │   ├── ToolDisplay.tsx                # EXTEND: Render subagent shortResult
    │   │   └── MessageList.tsx                # REUSE: Standard message rendering
    │   └── contexts/
    │       └── useChat.tsx                    # EXTEND: Register subagent callbacks
```

## Design Complexity Analysis

- **Multiple Manager Instances**: Isolated `AIManager`/`MessageManager` per subagent for context isolation.
- **Real-time Reporting**: Using the `shortResult` of the `Agent` tool block instead of a dedicated `SubagentBlock` component to keep the UI clean and integrated.
- **Strict Lifecycle**: Immediate cleanup of subagent instances after task completion to protect against OOM.
- **Configuration System**: File-based YAML parsing as required by specification.
