# Implementation Tasks: Deferred Tool Loading

## Phase 1: Core Infrastructure

- [ ] T001 Add `shouldDefer`, `alwaysLoad`, `isMcp` fields to `ToolPlugin` interface
- [ ] T002 Create `isDeferredTool()` helper utility
- [ ] T003 Create `ToolSearchTool` with select: and keyword search support

## Phase 2: Tool Manager Integration

- [ ] T004 Update `ToolManager.getToolsConfig()` to accept `discoveredTools` parameter
- [ ] T005 Update `ToolManager` to filter out undiscovered deferred tools
- [ ] T006 Add `getDeferredToolNames()` method to ToolManager

## Phase 3: AI Manager Integration

- [ ] T007 Add `discoveredTools` Set to AIManager
- [ ] T008 Track discovered tools from ToolSearch results
- [ ] T009 Pass discovered set to `getToolsConfig()` on each API call

## Phase 4: System Prompt Integration

- [ ] T010 List deferred tool names in `<available-deferred-tools>` section
- [ ] T011 Add guidance to call ToolSearch before invoking deferred tools

## Phase 5: MCP Integration

- [ ] T012 Set `isMcp: true` on all MCP tools in `createMcpToolPlugin()`
- [ ] T013 Mark built-in tools with `shouldDefer: true` (cron*, webFetch, worktree*, task*)

## Phase 6: Testing

- [ ] T014 Unit tests for `isDeferredTool()` helper
- [ ] T015 Unit tests for `ToolSearchTool` query formats
- [ ] T016 Unit tests for `ToolManager` filtering
- [ ] T017 Unit tests for system prompt integration
- [ ] T018 End-to-end demo verifying AI cycle discovery flow
