# Tasks: WebFetch Tool

**Input**: Design documents from `/specs/017-web-fetch-tool/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for the tool logic. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by phase to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create project structure and empty files per implementation plan
- [X] T002 [P] Add `turndown` and `@types/turndown` to `packages/agent-sdk/package.json`
- [X] T003 [P] Add `WEB_FETCH_TOOL_NAME` constant to `packages/agent-sdk/src/constants/tools.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T004 Update `ToolContext` in `packages/agent-sdk/src/tools/types.ts` to include `aiManager` and `aiService`
- [X] T005 Update `ToolManager` in `packages/agent-sdk/src/managers/toolManager.ts` to inject `aiManager` and `aiService` into the tool context

---

## Phase 3: User Story 1 - Basic Web Content Extraction (Priority: P1) 🎯 MVP

**Goal**: Allow users to fetch content from a URL and ask questions about it.

- [X] T006 [US1] Implement `WebFetchToolPlugin` in `packages/agent-sdk/src/tools/webFetchTool.ts` with basic fetch and AI processing
- [X] T007 [US1] Register `webFetchTool` in `packages/agent-sdk/src/managers/toolManager.ts`
- [X] T008 [US1] Unit tests for `WebFetchToolPlugin` in `packages/agent-sdk/tests/tools/webFetchTool.test.ts`

---

## Phase 4: User Story 2 - Redirect Handling (Priority: P2)

**Goal**: Inform users when a URL redirects to a different host.

- [X] T009 [US2] Update `WebFetchToolPlugin` to handle redirects and host changes in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T010 [US2] Add test cases for redirect handling in `packages/agent-sdk/tests/tools/webFetchTool.test.ts`

---

## Phase 5: User Story 3 - GitHub URL Handling (Priority: P2)

**Goal**: Suggest using the `gh` CLI for GitHub URLs.

- [X] T011 [US3] Update `WebFetchToolPlugin` to reject GitHub URLs and suggest `gh` CLI in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T012 [US3] Add test cases for GitHub URL handling in `packages/agent-sdk/tests/tools/webFetchTool.test.ts`

---

## Phase 6: User Story 4 - Caching (Priority: P3)

**Goal**: Implement a 15-minute self-cleaning cache for Markdown content.

- [X] T013 [US4] Implement in-memory cache in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T014 [US4] Add test cases for caching in `packages/agent-sdk/tests/tools/webFetchTool.test.ts`

---

## Phase 7: Optimization (Specialized AI Processing)

**Goal**: Replace `callAgent` with a lightweight `processWebContent` function.

- [X] T015 [P] Add `WEB_CONTENT_SYSTEM_PROMPT` to `packages/agent-sdk/src/prompts/index.ts`
- [X] T016 [P] Implement `processWebContent` in `packages/agent-sdk/src/services/aiService.ts`
- [X] T017 Update `WebFetchToolPlugin` to use `processWebContent` in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T018 Update unit tests to verify `processWebContent` usage in `packages/agent-sdk/tests/tools/webFetchTool.test.ts`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T019 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [X] T020 Run `quickstart.md` validation scenarios manually

---

## Phase 9: Security & Robustness Improvements

**Purpose**: Security limits, URL validation, LRU cache upgrade, output enrichment

- [X] T021 Add URL validation: max 2000 chars, reject credentials, reject localhost/single-part hostnames in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T022 Add security limits: 10MB content max, 60s fetch timeout, 10 redirect max in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T023 Improve redirect handling: follow same-host/www-variation redirects automatically in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T024 Upgrade cache to LRU: add `lru-cache` dependency, 50MB limit, remove setInterval in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T025 Add content truncation at 100K chars before AI processing in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T026 Update User-Agent to honest identifier, add Accept header in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T027 Enrich output with HTTP status code and content size in `packages/agent-sdk/src/tools/webFetchTool.ts`
- [X] T028 Update tests for all new behaviors in `packages/agent-sdk/tests/tools/webFetchTool.test.ts`
- [X] T029 Run `pnpm run type-check` and `pnpm lint` across the monorepo
