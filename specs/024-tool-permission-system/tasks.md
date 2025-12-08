# Tasks: Tool Permission System

**Input**: Design documents from `/specs/024-tool-permission-system/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included for essential functionality testing as per constitution requirements.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and permission system foundation

- [X] T001 Add permission-related types to packages/agent-sdk/src/types/index.ts
- [X] T002 [P] Create PermissionManager class in packages/agent-sdk/src/managers/permissionManager.ts
- [X] T003 [P] Extend AgentOptions interface with permissionMode and canUseTool in packages/agent-sdk/src/agent.ts
- [X] T004 [P] Extend ToolContext interface with permission fields in packages/agent-sdk/src/tools/types.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core permission infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Update ToolManager to pass permission context to tools in packages/agent-sdk/src/managers/toolManager.ts
- [X] T006 [P] Create ConfirmationComponent in packages/code/src/components/ConfirmationComponent.tsx
- [X] T007 [P] Extend useChat context with confirmation state in packages/code/src/contexts/useChat.tsx
- [X] T008 Update ChatInterface to conditionally render InputBox vs ConfirmationComponent in packages/code/src/components/ChatInterface.tsx
- [X] T009 Add --dangerously-skip-permissions CLI flag in packages/code/src/index.ts
- [X] T010 Update CLI to pass permission mode to Agent in packages/code/src/cli.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Default Safe Mode with Confirmations (Priority: P1) 🎯 MVP

**Goal**: Users run Wave CLI without flags and system prompts for confirmation before executing destructive operations (Edit, MultiEdit, Delete, Bash, Write). **Updated**: System handles multiple tool calls with individual sequential confirmations and batched result return.

**Independent Test**: Run any edit/delete/bash command and verify confirmation prompt appears with allow/deny options. Test multiple tool call scenarios to verify sequential confirmation behavior.

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T011 [P] [US1] Create permission manager tests in packages/agent-sdk/tests/managers/permissionManager.test.ts
- [X] T012 [P] [US1] Create agent permission integration tests in packages/agent-sdk/tests/agent/agent.permissions.test.ts
- [X] T013 [P] [US1] Create confirmation component tests in packages/code/tests/components/ConfirmationComponent.test.ts

### Implementation for User Story 1

- [X] T014 [P] [US1] Add permission check to Edit tool after validation/diff in packages/agent-sdk/src/tools/editTool.ts
- [X] T015 [P] [US1] Add permission check to MultiEdit tool after validation/diff in packages/agent-sdk/src/tools/multiEditTool.ts
- [X] T016 [P] [US1] Add permission check to Delete tool after validation/diff in packages/agent-sdk/src/tools/deleteFileTool.ts
- [X] T017 [P] [US1] Add permission check to Bash tool after validation/diff in packages/agent-sdk/src/tools/bashTool.ts
- [X] T018 [P] [US1] Add permission check to Write tool after validation/diff in packages/agent-sdk/src/tools/writeTool.ts
- [X] T019 [US1] Implement CLI confirmation flow with "Do you want to proceed?" prompt in ConfirmationComponent
- [X] T020 [US1] Add keyboard navigation (arrow keys) and ESC handling to ConfirmationComponent
- [X] T021 [US1] Implement alternative instructions input with placeholder hiding logic in ConfirmationComponent
- [X] T022 [US1] Connect confirmation decisions to tool permission system via useChat context
- [X] T023 [US1] Implement multiple tool call sequential confirmation handling with queue-based architecture and batched result return

**Checkpoint**: At this point, User Story 1 should be fully functional - CLI prompts for confirmation on restricted tools and users can approve/deny, with support for multiple tool call scenarios

---

## Phase 4: User Story 2 - Bypass Mode for Advanced Users (Priority: P2)

**Goal**: Advanced users can run Wave CLI with --dangerously-skip-permissions flag to bypass all permission checks for uninterrupted operation

**Independent Test**: Run Wave CLI with bypass flag and verify no confirmation prompts appear for any destructive operations

### Implementation for User Story 2

- [X] T024 [US2] Update permission check logic to respect bypassPermissions mode in PermissionManager
- [X] T025 [US2] Add bypass mode validation in packages/agent-sdk/src/agent.ts constructor
- [X] T026 [US2] Ensure all restricted tools skip permission checks when in bypass mode
- [X] T027 [US2] Add bypass mode tests to verify no prompts appear in packages/agent-sdk/tests/agent/agent.permissions.test.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - normal mode shows prompts, bypass mode skips all prompts

---

## Phase 5: User Story 3 - Agent SDK Callback Integration (Priority: P3)

**Goal**: Developers can provide custom canUseTool callback for implementing custom authorization workflows in Agent SDK integrations

**Independent Test**: Create test agent with custom canUseTool callback and verify it's called appropriately for restricted tools with proper allow/deny behavior

### Implementation for User Story 3

- [X] T028 [P] [US3] Implement canUseTool callback invocation in PermissionManager.checkPermission method
- [X] T029 [P] [US3] Add callback exception handling with proper deny/abort behavior in PermissionManager
- [X] T030 [US3] Ensure callback is called after tool validation/diff but before real operations
- [X] T031 [US3] Add callback integration tests in packages/agent-sdk/tests/managers/permissionManager.test.ts
- [X] T032 [US3] Add Agent SDK callback examples to packages/agent-sdk/examples/ directory
- [X] T033 [US3] Validate callback return value format and error handling

**Checkpoint**: All user stories should now be independently functional - default mode prompts, bypass mode skips, custom callbacks work

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure production readiness

- [X] T034 [P] Build agent-sdk package with pnpm build
- [X] T035 [P] Run type checking with pnpm run type-check across all packages
- [X] T036 [P] Run linting with pnpm lint across all packages  
- [ ] T037 [P] Add error logging for permission denied operations
- [ ] T038 Validate backward compatibility - existing AgentOptions continue working
- [ ] T039 Run quickstart.md validation scenarios
- [ ] T040 [P] Update existing tool tests to handle permission context in packages/agent-sdk/tests/tools/

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Extends US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Extends US1 but should be independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Permission manager logic before individual tool modifications
- Tool modifications before CLI integration  
- Core implementation before UI/UX features
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Individual tool modifications within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Create permission manager tests in packages/agent-sdk/tests/managers/permissionManager.test.ts"
Task: "Create agent permission integration tests in packages/agent-sdk/tests/agent/agent.permissions.test.ts"  
Task: "Create confirmation component tests in packages/code/tests/components/ConfirmationComponent.test.ts"

# Launch all tool modifications for User Story 1 together:
Task: "Add permission check to Edit tool after validation/diff in packages/agent-sdk/src/tools/editTool.ts"
Task: "Add permission check to MultiEdit tool after validation/diff in packages/agent-sdk/src/tools/multiEditTool.ts"
Task: "Add permission check to Delete tool after validation/diff in packages/agent-sdk/src/tools/deleteFileTool.ts" 
Task: "Add permission check to Bash tool after validation/diff in packages/agent-sdk/src/tools/bashTool.ts"
Task: "Add permission check to Write tool after validation/diff in packages/agent-sdk/src/tools/writeTool.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)  
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently - run edit/delete/bash commands and verify prompts appear
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo  
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Default safe mode)
   - Developer B: User Story 2 (Bypass mode)  
   - Developer C: User Story 3 (SDK callbacks)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability  
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Remember to build agent-sdk with pnpm build before testing in code package
- All permission checks must occur after validation/diff but before real operations
- Read-only tools (Read, Grep, LS, Glob) are explicitly excluded from permission checks
- ESC key must hide confirmation and abort tool operation
- InputBox must be hidden when confirmation component is visible
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently