# Tasks: Read Tool Image Support

**Input**: Design documents from `/specs/022-read-image-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included following Wave Agent Constitution VIII (Test-Driven Development).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo package enhancement**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- Following existing agent-sdk package structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Verify existing ToolResult.images interface in packages/agent-sdk/src/tools/types.ts
- [x] T002 Verify existing convertImageToBase64 utility in packages/agent-sdk/src/utils/messageOperations.ts
- [x] T003 [P] Verify existing binaryExtensions array in packages/agent-sdk/src/utils/path.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create image file detection helper functions in packages/agent-sdk/src/tools/readTool.ts
- [x] T005 [P] Create image size validation utility in packages/agent-sdk/src/tools/readTool.ts
- [x] T006 [P] Create MIME type mapping utility in packages/agent-sdk/src/tools/readTool.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Read Image Files (Priority: P1) 🎯 MVP

**Goal**: Agent reads image files (PNG, JPEG, GIF, WebP) and provides visual content to multimodal AI models

**Independent Test**: Can be fully tested by calling the Read tool with an image file path and verifies that image data is returned in base64 format in the ToolResult.images array

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T007 [P] [US1] Write test for PNG image processing in packages/agent-sdk/tests/tools/readTool.test.ts
- [x] T008 [P] [US1] Write test for JPEG image processing in packages/agent-sdk/tests/tools/readTool.test.ts
- [x] T009 [P] [US1] Write test for file not found error handling in packages/agent-sdk/tests/tools/readTool.test.ts

### Implementation for User Story 1

- [x] T010 [US1] Implement image file detection logic in readTool execute function in packages/agent-sdk/src/tools/readTool.ts
- [x] T011 [US1] Implement processImageFile function with base64 conversion in packages/agent-sdk/src/tools/readTool.ts
- [x] T012 [US1] Add ToolResult.images population for PNG files in packages/agent-sdk/src/tools/readTool.ts
- [x] T013 [US1] Add ToolResult.images population for JPEG files in packages/agent-sdk/src/tools/readTool.ts
- [x] T014 [US1] Ensure backward compatibility with text file processing in packages/agent-sdk/src/tools/readTool.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Support Multiple Image Formats (Priority: P2)

**Goal**: Agent correctly handles different image file formats (JPEG, PNG, GIF, WebP) with proper MIME type detection and encoding

**Independent Test**: Can be tested by reading various image format files and verifying that each format returns the correct MIME type and successfully encodes to base64

### Tests for User Story 2

- [x] T015 [P] [US2] Write test for GIF image format support in packages/agent-sdk/tests/tools/readTool.test.ts
- [x] T016 [P] [US2] Write test for WebP image format support in packages/agent-sdk/tests/tools/readTool.test.ts
- [x] T017 [P] [US2] Write test for case-insensitive extension detection in packages/agent-sdk/tests/tools/readTool.test.ts

### Implementation for User Story 2

- [x] T018 [P] [US2] Add GIF format support and MIME type detection in packages/agent-sdk/src/tools/readTool.ts
- [x] T019 [P] [US2] Add WebP format support and MIME type detection in packages/agent-sdk/src/tools/readTool.ts
- [x] T020 [US2] Implement case-insensitive extension detection in packages/agent-sdk/src/tools/readTool.ts
- [x] T021 [US2] Add comprehensive MIME type validation for all supported formats in packages/agent-sdk/src/tools/readTool.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Handle Image File Errors Gracefully (Priority: P3)

**Goal**: Agent provides clear error messages when image files are corrupted, unsupported formats, or when file access issues occur

**Independent Test**: Can be tested by attempting to read corrupted image files, unsupported formats, and files with permission issues to verify appropriate error responses

### Tests for User Story 3

- [x] T022 [P] [US3] Write test for 20MB file size limit enforcement in packages/agent-sdk/tests/tools/readTool.test.ts
- [x] T023 [P] [US3] Write test for corrupted image file handling in packages/agent-sdk/tests/tools/readTool.test.ts
- [x] T024 [P] [US3] Write test for unsupported image format handling in packages/agent-sdk/tests/tools/readTool.test.ts

### Implementation for User Story 3

- [x] T025 [US3] Implement 20MB file size limit validation with clear error messages in packages/agent-sdk/src/tools/readTool.ts
- [x] T026 [US3] Add graceful error handling for corrupted image files in packages/agent-sdk/src/tools/readTool.ts
- [x] T027 [US3] Add graceful error handling for file access permission issues in packages/agent-sdk/src/tools/readTool.ts
- [x] T028 [US3] Implement descriptive error messages for all image processing failures in packages/agent-sdk/src/tools/readTool.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T029 [P] Build agent-sdk package with pnpm build in packages/agent-sdk/
- [ ] T030 [P] Run TypeScript type checking with pnpm run type-check
- [ ] T031 [P] Run linting validation with pnpm run lint  
- [ ] T032 Verify ToolResultDisplay component handles images in packages/code/src/components/ToolResultDisplay.tsx
- [ ] T033 Test end-to-end image processing with real image files using quickstart.md scenarios
- [ ] T034 [P] Run comprehensive test suite with pnpm test in packages/agent-sdk/

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
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Extends US1/US2 but should be independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD Red phase)
- Helper functions before main implementation
- Core image processing before format-specific implementations
- Error handling after successful path implementation
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Format-specific implementations within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Write test for PNG image processing in packages/agent-sdk/tests/tools/readTool.test.ts"
Task: "Write test for JPEG image processing in packages/agent-sdk/tests/tools/readTool.test.ts"
Task: "Write test for file not found error handling in packages/agent-sdk/tests/tools/readTool.test.ts"

# After tests pass, launch format-specific implementations together:
Task: "Add ToolResult.images population for PNG files in packages/agent-sdk/src/tools/readTool.ts"
Task: "Add ToolResult.images population for JPEG files in packages/agent-sdk/src/tools/readTool.ts"
```

---

## Parallel Example: User Story 2

```bash
# Launch all format tests together:
Task: "Write test for GIF image format support in packages/agent-sdk/tests/tools/readTool.test.ts"
Task: "Write test for WebP image format support in packages/agent-sdk/tests/tools/readTool.test.ts"
Task: "Write test for case-insensitive extension detection in packages/agent-sdk/tests/tools/readTool.test.ts"

# Launch format implementations together:
Task: "Add GIF format support and MIME type detection in packages/agent-sdk/src/tools/readTool.ts"
Task: "Add WebP format support and MIME type detection in packages/agent-sdk/src/tools/readTool.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Build and validate with quality gates

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Build/Deploy (MVP!)
3. Add User Story 2 → Test independently → Build/Deploy
4. Add User Story 3 → Test independently → Build/Deploy
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Core image processing)
   - Developer B: User Story 2 (Format support) 
   - Developer C: User Story 3 (Error handling)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Follow TDD workflow: Red (failing test) → Green (make test pass) → Refactor
- Build agent-sdk after modifications before testing in dependent packages
- Run type-check and lint validation after each significant change
- Verify tests fail before implementing (Red phase of TDD)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently