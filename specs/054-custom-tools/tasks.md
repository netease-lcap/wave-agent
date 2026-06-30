# Tasks: Custom Tools via buildTool()

**Input**: Design documents from `/specs/054-custom-tools/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality.

**Organization**: Tasks grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and type definitions

- [x] T001 [P] [US1] Create `ToolDef` interface and `buildTool()` factory in `packages/agent-sdk/src/tools/buildTool.ts`
- [x] T002 [P] [US1] Add `customTools?: ToolPlugin[]` to `AgentOptions` in `packages/agent-sdk/src/types/agent.ts`
- [x] T003 [P] [US1] Export `buildTool`, `ToolPlugin`, `ToolResult`, `ToolContext` from `packages/agent-sdk/src/index.ts`

---

## Phase 2: User Story 1 - Define Custom Tools with buildTool() (Priority: P1) 🎯 MVP

**Goal**: SDK users can define custom tools via `buildTool()` and register them through `Agent.create({ customTools: [...] })`.

**Independent Test**: Create a tool, pass it to Agent.create, send a message, verify the tool is callable.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T004 [P] [US1] Unit tests for buildTool in `packages/agent-sdk/tests/tools/buildTool.test.ts`
  - Basic tool creation (name, description, parameters, execute)
  - With `required` array
  - With `prompt` as string → normalized to function
  - With `prompt` as function → passed through
  - Output matches `ToolPlugin` shape
  - Tool execution returns correct result
  - With `formatCompactParams`
  - With `additionalProperties`

### Implementation for User Story 1

- [x] T005 [US1] Add `customTools?: ToolPlugin[]` to `ToolManagerOptions` in `packages/agent-sdk/src/managers/toolManager.ts`
- [x] T006 [US1] Store `customTools` in ToolManager constructor and register them in `initializeBuiltInTools()`
- [x] T007 [US1] Pass `options.customTools` to ToolManager in `packages/agent-sdk/src/utils/containerSetup.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 3: User Story 2 - Advanced Tool Features (Priority: P2)

**Goal**: Custom tools support `formatCompactParams` and dynamic prompts.

**Independent Test**: Create a tool with `formatCompactParams`, verify the compact representation appears in tool blocks. Create a tool with a dynamic `prompt` function, verify the description is context-aware.

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] T008 [P] [US2] Unit tests for advanced features in `packages/agent-sdk/tests/tools/buildTool.test.ts`
  - `formatCompactParams` → passed through to ToolPlugin
  - `additionalProperties: true` → reflected in config schema

### Implementation for User Story 2

(No additional implementation tasks — advanced features are handled by `buildTool()` factory.)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 4: User Story 3 - Selective Tool Enablement (Priority: P2)

**Goal**: Custom tools respect the `tools` whitelist and permission rules.

**Independent Test**: Pass custom tools with a `tools` whitelist, verify only whitelisted custom tools are registered.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T009 [P] [US3] Integration test for custom tool filtering in `packages/agent-sdk/tests/tools/customToolsIntegration.test.ts`
  - Custom tools with `tools` whitelist
  - Custom tools with `disallowedTools` rule

### Implementation for User Story 3

- [ ] T010 [US3] Verify `shouldEnableTool()` applies to custom tools (no changes needed — already used in registration loop)

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T011 [P] Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [x] T012 [P] Create example in `packages/agent-sdk/examples/build-tool-demo.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **User Story 1 (Phase 2)**: Depends on Setup (Phase 1). Core MVP.
- **User Story 2 (Phase 3)**: Depends on User Story 1 (Phase 2). Advanced features.
- **User Story 3 (Phase 4)**: Depends on User Story 1 (Phase 2). Permission filtering.
- **Polish (Phase 5)**: Depends on all user stories.

### Parallel Opportunities

- T001, T002, T003 (Setup tasks)
- T004, T005 (US1 test + implementation can proceed together after setup)
