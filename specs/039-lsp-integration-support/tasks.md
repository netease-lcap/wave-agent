# Tasks: LSP Integration Support

**Input**: Design documents from `/specs/039-lsp-integration-support/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Define LSP configuration and process types in `data-model.md`
- [X] T002 Research LSP server management and communication patterns in `research.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T003 Implement `LspManager` for process lifecycle and JSON-RPC communication in `packages/agent-sdk/src/managers/lspManager.ts`
- [X] T004 Implement JSON-RPC message framing (Content-Length) in `packages/agent-sdk/src/managers/lspManager.ts`
- [X] T005 Implement `textDocument/didOpen` synchronization in `packages/agent-sdk/src/managers/lspManager.ts`
- [X] T006 Support loading configuration from `.lsp.json` in `packages/agent-sdk/src/managers/lspManager.ts`
- [X] T007 Integrate `LspManager` into `Agent` class and `ToolManager`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Code Navigation (Priority: P1) 🎯 MVP

**Goal**: Enable `goToDefinition` and `findReferences`.

**Independent Test**: Call `lsp` tool for definition and verify result.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T008 [US1] Write unit tests for `goToDefinition` in `packages/agent-sdk/tests/tools/lspTool.test.ts`

### Implementation for User Story 1

- [X] T009 [US1] Implement `goToDefinition` in `packages/agent-sdk/src/tools/lspTool.ts`
- [X] T010 [US1] Implement `findReferences` in `packages/agent-sdk/src/tools/lspTool.ts`
- [X] T011 [US1] Implement `goToImplementation` in `packages/agent-sdk/src/tools/lspTool.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Type and Documentation Inspection (Priority: P1)

**Goal**: Enable `hover` and symbol listing.

**Independent Test**: Call `lsp` tool for hover and verify documentation.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T012 [US2] Write unit tests for `hover` and `documentSymbol`

### Implementation for User Story 2

- [X] T013 [US2] Implement `hover` in `packages/agent-sdk/src/tools/lspTool.ts`
- [X] T014 [US2] Implement `documentSymbol` and `workspaceSymbol` in `packages/agent-sdk/src/tools/lspTool.ts`

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 3 - Call Hierarchy Exploration (Priority: P2)

**Goal**: Enable call hierarchy operations.

**Independent Test**: Explore incoming calls for a function.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T015 [US3] Write unit tests for call hierarchy operations

### Implementation for User Story 3

- [X] T016 [US3] Implement `prepareCallHierarchy`, `incomingCalls`, and `outgoingCalls` in `packages/agent-sdk/src/tools/lspTool.ts`

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T017 [P] Implement graceful shutdown in `LspManager`
- [X] T018 [P] Implement response formatting and URI-to-path conversion in `lspTool`
- [X] T019 [P] Final type-check and linting
