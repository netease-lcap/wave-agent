# Tasks: Diff Display UX Refinement

**Input**: Design documents from `/specs/030-diff-display-ux-refinement/`  
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/  
**Tests**: Not explicitly requested in specification  
**Organization**: Tasks grouped by user story for independent implementation

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure) ✅ **COMPLETED**

**Purpose**: Project setup and dependency management

- [x] T001 Update Change interface in packages/agent-sdk/src/types/core.ts to use oldContent and newContent
- [x] T002 Update transformation function in packages/agent-sdk/src/utils/diff-transform.ts for new interface
- [x] T003 Export transformation function from packages/agent-sdk/src/index.ts
- [x] T004 Build agent-sdk to make new exports available

---

## Phase 2: Foundational (Blocking Prerequisites) ✅ **COMPLETED**

**Purpose**: Core infrastructure that MUST be complete before user stories

- [x] T005 Add @types/diff dependency to packages/code/package.json
- [x] T006 Install dependencies using pnpm workspace management
- [x] T007 Remove diff dependency from packages/agent-sdk/package.json
- [x] T008 Update imports in packages/code/src/components/ToolResultDisplay.tsx

**Checkpoint**: Foundation ready - user story implementation can now proceed

---

## Phase 3: User Story 1 - Unified Tool Result Display (Priority: P1) 🎯 MVP

**Goal**: Consolidate diff display functionality directly into ToolResultDisplay component with proper diff library integration

**Independent Test**: Execute Write, Edit, or MultiEdit tools and verify differences appear within tool results in both collapsed and expanded states

### Implementation for User Story 1 ✅ **COMPLETED**

- [x] T009 [US1] Add diff detection logic to packages/code/src/components/ToolResultDisplay.tsx
- [x] T010 [US1] Implement proper diff rendering using diffLines from diff library in packages/code/src/components/ToolResultDisplay.tsx
- [x] T011 [US1] Add word-level diff support using diffWords in packages/code/src/components/ToolResultDisplay.tsx
- [x] T012 [US1] Update collapsed diff summary to show file path and change counts in packages/code/src/components/ToolResultDisplay.tsx
- [x] T013 [US1] Update expanded diff view with proper unified diff format and color scheme in packages/code/src/components/ToolResultDisplay.tsx
- [x] T014 [US1] Add error handling for invalid diff data in packages/code/src/components/ToolResultDisplay.tsx

**Checkpoint**: Diff display should be fully functional within tool results

---

## Phase 4: User Story 2 - Removed Separate Diff Components (Priority: P2)

**Goal**: Remove all separate difference display functionality and centralize in ToolResultDisplay

**Independent Test**: Verify no separate diff components exist and all diff functionality works through unified tool results display

### Implementation for User Story 2 ✅ **COMPLETED**

- [x] T015 [US2] Delete packages/code/src/components/DiffViewer.tsx file entirely
- [x] T016 [US2] Remove DiffViewer import from packages/code/src/components/MessageItem.tsx
- [x] T017 [US2] Remove diff block rendering logic from packages/code/src/components/MessageItem.tsx
- [x] T018 [P] [US2] Search for remaining DiffViewer references in packages/code/src/ and remove them
- [x] T019 [P] [US2] Search for remaining diff block references in packages/code/src/ and remove them
- [x] T020 [US2] Verify no separate diff functionality imports remain in codebase

**Checkpoint**: All separate diff components removed, functionality consolidated

---

## Phase 5: User Story 3 - Tool-Specific Diff Display (Priority: P3)

**Goal**: Ensure diff display shows appropriate content based on tool type (Write, Edit, MultiEdit)

**Independent Test**: Execute each tool type and verify correct parameter-based diff display format

### Implementation for User Story 3 ✅ **COMPLETED**

- [x] T021 [P] [US3] Update Write tool transformation in packages/agent-sdk/src/utils/diff-transform.ts
- [x] T022 [P] [US3] Update Edit tool transformation in packages/agent-sdk/src/utils/diff-transform.ts  
- [x] T023 [P] [US3] Update MultiEdit tool transformation in packages/agent-sdk/src/utils/diff-transform.ts
- [x] T024 [US3] Add parameter parsing logic for different tool parameter formats in packages/agent-sdk/src/utils/diff-transform.ts
- [x] T025 [US3] Add file path extraction from tool parameters in packages/agent-sdk/src/utils/diff-transform.ts
- [x] T026 [US3] Validate tool-specific diff logic with actual tool parameter examples

**Checkpoint**: All tool types display diffs correctly based on their parameters

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements and validation

- [x] T027 [P] Build both packages to verify compilation in packages/agent-sdk and packages/code
- [x] T028 [P] Run type checking on both packages using npm run type-check
- [x] T029 [P] Run linting on modified files using npm run lint
- [x] T030 Test Write tool diff display with sample content parameter
- [x] T031 Test Edit tool diff display with sample old_string and new_string parameters
- [x] T032 Test MultiEdit tool diff display with sample edits array
- [x] T033 Test unsupported tool types return no diff display
- [x] T034 Test error handling for malformed tool parameters
- [x] T035 Validate color scheme matches original DiffViewer.tsx exactly
- [x] T036 Refactor DiffDisplay to accept toolName and parameters props
- [x] T037 Update ToolResultDisplay to only show DiffDisplay when stage is "end"
- [x] T038 Update Confirmation to render DiffDisplay for user approval

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: ✅ Complete - Agent-sdk interface updated
- **Foundational (Phase 2)**: ✅ Complete - Dependencies moved, imports updated
- **User Stories (Phase 3+)**: Can proceed, some tasks already started
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: ✅ Foundation complete - Can proceed with remaining diff rendering tasks
- **User Story 2 (P2)**: ✅ Foundation complete - Can proceed with remaining cleanup tasks
- **User Story 3 (P3)**: ✅ Foundation complete - Can proceed with remaining tool-specific logic

### Within Each User Story

- User Story 1: Core diff functionality before word-level enhancements
- User Story 2: Component removal before reference cleanup
- User Story 3: Basic transformation before parameter parsing enhancements

### Parallel Opportunities

- T010-T014 (US1) can run in sequence as they modify the same file
- T018-T019 (US2) can run in parallel as they search different areas
- T021-T023 (US3) ✅ already completed in parallel
- T027-T029 (Polish) can run in parallel as they test different aspects
- T030-T035 (Polish) testing tasks can run in parallel

---

## Parallel Example: User Story 1

```bash
# Sequential execution for same-file modifications:
Task T010: "Implement proper diff rendering using diffLines"
Task T011: "Add word-level diff support using diffWords"  
Task T012: "Update collapsed diff summary"
Task T013: "Update expanded diff view"
Task T014: "Add error handling"
```

---

## Implementation Strategy

### Final Status ✅ **ALL PHASES COMPLETED**
- **Phase 1 & 2**: ✅ Complete - Infrastructure ready
- **Phase 3**: ✅ Complete - Full diff display functionality implemented with proper diff library integration
- **Phase 4**: ✅ Complete - All separate diff components removed and functionality consolidated
- **Phase 5**: ✅ Complete - Tool-specific parameter parsing and transformation logic implemented
- **Phase 6**: ✅ Complete - All testing, validation, and quality checks passed

### Implementation Summary
1. ✅ Foundation → Infrastructure ready (Phases 1 & 2)
2. ✅ User Story 1 → Core diff display functional with diffLines and diffWords integration
3. ✅ User Story 2 → All separate diff components removed, functionality consolidated
4. ✅ User Story 3 → Tool-specific parameter parsing and transformation complete
5. ✅ Polish → Full validation, testing, compilation, type checking, and linting passed

### Validation Results
- **Build**: ✅ Both packages compile successfully
- **Type Check**: ✅ No TypeScript errors
- **Linting**: ✅ All linting rules pass
- **Write Tool**: ✅ Correctly transforms content parameter to diff display
- **Edit Tool**: ✅ Correctly transforms old_string/new_string to diff display
- **MultiEdit Tool**: ✅ Correctly transforms edits array to multiple diff displays
- **Error Handling**: ✅ Gracefully handles malformed parameters
- **Color Scheme**: ✅ Exactly matches original DiffViewer.tsx colors

---

## Notes

- Current implementation has basic diff detection but needs proper diff library integration
- Change interface successfully updated to use oldContent/newContent pattern
- DiffViewer component removed, MessageItem updated
- Transformation functions updated for new interface
- Remaining work focuses on proper diff rendering and comprehensive testing
- All [P] tasks can run in parallel unless they modify the same files
- Each user story should be independently testable once complete