# Tasks: Subagent Support

**Input**: Design documents from `/specs/009-subagent/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

## Phase 1: Core SDK Infrastructure (agent-sdk)

- [X] T001 Define `SubagentConfiguration` and `SubagentInstance` interfaces
- [X] T002 Implement `SubagentManager` for configuration loading and lifecycle management
- [X] T003 Implement `subagentParser` for YAML frontmatter configuration files
- [X] T004 Implement isolated `AIManager` and `MessageManager` per subagent instance
- [X] T005 Implement `Agent` tool plugin for task delegation
- [X] T006 Implement recursion protection (deny `Agent` tool within subagents)
- [X] T007 Implement resource cleanup via `subagentManager.cleanupInstance(subagentId)`

## Phase 2: Progress Reporting (agent-sdk)

- [X] T008 Define `SubagentManagerCallbacks` for granular subagent events
- [X] T009 Implement event forwarding from subagent instances to parent callbacks
- [X] T010 Update `Agent` tool to register `onUpdate` callback for the subagent instance
- [X] T011 Implement `shortResult` calculation in the `Agent` tool using tool execution and token usage data

## Phase 3: CLI Integration (code)

- [X] T012 Update `ToolDisplay` component to render dynamic `shortResult` updates
- [X] T013 Update `useChat` context to initialize the Agent with subagent-compatible callbacks
- [X] T014 Remove obsolete `SubagentBlock` component and associated state if present

## Phase 4: Verification

- [ ] T015 Verify project-level and user-level subagent discovery
- [ ] T016 Verify real-time progress updates in the `Agent` tool block
- [ ] T017 Verify full task result return to main conversation
- [ ] T018 Verify memory cleanup after subagent completion
- [ ] T019 Verify background task support for subagents

## Notes

- Subagents are implemented as tool calls that return their final results to the main agent.
- Progress is reflected in the `Agent` tool block's `shortResult` property.
- To prevent OOM, the CLI should NOT persist subagent message history after task completion.
- Subagent instances MUST be cleaned up immediately after returning their results.