# Tasks: Subagent Support

**Input**: Design documents from `/specs/006-subagent-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT included as they were not requested in the feature specification

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create subagent directory structure (.wave/agents/ for project configs, ~/.wave/agents/ for user configs)
- [ ] T002 [P] Add YAML parsing dependencies to packages/agent-sdk/package.json if needed
- [ ] T003 [P] Update packages/agent-sdk/src/types.ts to export subagent message block types

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create TaskDelegation interface in packages/agent-sdk/src/tools/types.ts
- [ ] T005 [P] Create SubagentConfiguration interface in packages/agent-sdk/src/services/subagentConfig.ts
- [ ] T006 [P] Create SubagentInstance interface in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T007 [P] Create SubagentBlock interface in packages/agent-sdk/src/types.ts
- [ ] T008 [P] Extend MessageManagerCallbacks interface in packages/agent-sdk/src/managers/messageManager.ts
- [ ] T009 Create base SubagentManager class in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T010 Create subagent configuration parser service in packages/agent-sdk/src/services/subagentConfig.ts
- [ ] T011 Export new managers and services from packages/agent-sdk/src/index.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Create and Configure Subagents (Priority: P1) 🎯 MVP

**Goal**: Users can create specialized subagents for their project with domain expertise and appropriate tool access

**Independent Test**: Create a subagent configuration file in .wave/agents/ with valid YAML frontmatter and verify it can be loaded and parsed by the system

### Implementation for User Story 1

- [ ] T012 [P] [US1] Implement YAML frontmatter parsing logic in packages/agent-sdk/src/services/subagentConfig.ts
- [ ] T013 [P] [US1] Implement directory scanning for .wave/agents/ and ~/.wave/agents/ in packages/agent-sdk/src/services/subagentConfig.ts
- [ ] T014 [US1] Implement subagent configuration validation (name pattern, required fields) in packages/agent-sdk/src/services/subagentConfig.ts
- [ ] T015 [US1] Implement precedence rules (project over user) in packages/agent-sdk/src/services/subagentConfig.ts
- [ ] T016 [US1] Add configuration loading methods to SubagentManager in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T017 [US1] Add error handling for invalid YAML and missing fields in packages/agent-sdk/src/services/subagentConfig.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Automatic Task Delegation (Priority: P2)

**Goal**: Wave Agent automatically recognizes when a task matches a subagent's expertise and delegates appropriately

**Independent Test**: Configure subagents with clear expertise descriptions and issue tasks that match those descriptions, then verify automatic delegation occurs

### Implementation for User Story 2

- [ ] T018 [P] [US2] Create Task tool plugin structure in packages/agent-sdk/src/tools/taskTool.ts
- [ ] T019 [P] [US2] Implement task description matching algorithm in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T020 [US2] Implement subagent selection logic with specificity scoring in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T021 [US2] Create SubagentInstance creation logic in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T022 [US2] Implement isolated aiManager and messageManager per instance in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T023 [US2] Implement Task tool execute method with delegation workflow in packages/agent-sdk/src/tools/taskTool.ts
- [ ] T024 [US2] Add Task tool to tool registry in packages/agent-sdk/src/tools/index.ts
- [ ] T025 [US2] Implement tool access restriction based on subagent configuration in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T026 [US2] Implement model configuration per subagent in packages/agent-sdk/src/managers/subagentManager.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Explicit Subagent Invocation (Priority: P3)

**Goal**: Users can explicitly request a specific subagent for a task, giving full control over which specialized agent handles requests

**Independent Test**: Mention a specific subagent by name in a request and verify that the named subagent handles the task

### Implementation for User Story 3

- [ ] T027 [P] [US3] Implement explicit subagent name matching in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T028 [US3] Add subagent existence validation with error messages in packages/agent-sdk/src/tools/taskTool.ts
- [ ] T029 [US3] Implement available subagents listing in error responses in packages/agent-sdk/src/tools/taskTool.ts

**Checkpoint**: User Stories 1, 2, and 3 should now be independently functional

---

## Phase 6: User Story 4 - Subagent Context Isolation (Priority: P2)

**Goal**: Each subagent maintains its own context window separate from main conversation for focused specialized work

**Independent Test**: Have a long main conversation, then delegate to a subagent and verify it doesn't reference unrelated previous conversation elements

### Implementation for User Story 4

- [ ] T030 [P] [US4] Implement context isolation in SubagentInstance creation in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T031 [US4] Implement task execution with isolated context in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T032 [US4] Implement result collection and cleanup in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T033 [US4] Add circular delegation prevention in packages/agent-sdk/src/tools/taskTool.ts

**Checkpoint**: Context isolation should be verified and working

---

## Phase 7: User Story 5 - Subagent Message Display (Priority: P2)

**Goal**: Subagent conversations display as expandable blocks within the message list for tracking activity while maintaining main conversation focus

**Independent Test**: Trigger a subagent and verify the message block appears with correct visual indicators, collapse/expand behavior, and message preview functionality

### Implementation for User Story 5

- [ ] T034 [P] [US5] Create SubagentBlock React component in packages/code/src/components/SubagentBlock.tsx
- [ ] T035 [P] [US5] Implement collapsed state showing up to 2 recent messages in packages/code/src/components/SubagentBlock.tsx
- [ ] T036 [P] [US5] Implement expanded state showing up to 10 recent messages in packages/code/src/components/SubagentBlock.tsx
- [ ] T037 [P] [US5] Add distinctive border styling with magenta color in packages/code/src/components/SubagentBlock.tsx
- [ ] T038 [P] [US5] Implement subagent name/icon header with status indicators in packages/code/src/components/SubagentBlock.tsx
- [ ] T039 [US5] Add SubagentBlock rendering to MessageList in packages/code/src/components/MessageList.tsx
- [ ] T040 [US5] Integrate SubagentBlock with existing isExpanded prop pattern in packages/code/src/components/MessageList.tsx
- [ ] T041 [US5] Add SubagentBlock message creation in Task tool result processing in packages/agent-sdk/src/tools/taskTool.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T042 [P] Update packages/agent-sdk/src/managers/messageManager.ts to handle SubagentBlock message creation
- [ ] T043 [P] Add comprehensive error handling across all subagent operations
- [ ] T044 [P] Implement performance optimization for subagent selection (<500ms target)
- [ ] T045 [P] Add resource cleanup for completed subagent instances
- [ ] T046 Run quickstart.md validation scenarios
- [ ] T047 Update build process in packages/agent-sdk to export all new types and managers

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 configuration loading
- **User Story 3 (P3)**: Can start after US2 completion - Extends Task tool functionality
- **User Story 4 (P2)**: Can start after US2 completion - Enhances SubagentInstance isolation
- **User Story 5 (P2)**: Can start after US2 completion - Adds UI layer for subagent display

### Within Each User Story

- Configuration services before managers
- Interfaces before implementations
- Core logic before UI components
- Tool registration after tool implementation
- Error handling after core functionality
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once US1 completes, US2-5 can start in parallel (if team capacity allows)
- Within each user story, tasks marked [P] can run in parallel
- UI components (US5) can be developed in parallel with backend logic

---

## Parallel Example: User Story 2

```bash
# Launch foundational interfaces together:
Task: "Create Task tool plugin structure in packages/agent-sdk/src/tools/taskTool.ts"
Task: "Implement task description matching algorithm in packages/agent-sdk/src/managers/subagentManager.ts"
Task: "Implement subagent selection logic with specificity scoring in packages/agent-sdk/src/managers/subagentManager.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently - create and load subagent configs
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (automatic delegation)
4. Add User Stories 3,4,5 → Test independently → Deploy/Demo (full feature)
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (configuration)
   - Developer B: User Story 2 (delegation) - starts after US1
   - Developer C: User Story 5 (UI) - starts after US2
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- No tests included as they were not requested in specification
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Build packages/agent-sdk before packages/code due to dependency
- Follow existing tool plugin patterns and React component patterns