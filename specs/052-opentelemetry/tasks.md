# Tasks: OpenTelemetry Integration

**Input**: Design documents from `/specs/052-opentelemetry/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality.

**Organization**: Tasks grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependencies, and type definitions

- [x] T001 Create project structure and empty files per implementation plan
- [x] T002 [P] [US1] Add @opentelemetry/* dependencies to `packages/agent-sdk/package.json`
- [x] T003 [P] [US1] Define TelemetryConfig, span metadata types in `packages/agent-sdk/src/types/telemetry.ts`
- [x] T004 [P] [US1] Add monitoring.telemetry field to WaveConfiguration in `packages/agent-sdk/src/types/configuration.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core telemetry infrastructure that MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement `instrumentation.ts` with MeterProvider, TracerProvider, LoggerProvider setup in `packages/agent-sdk/src/telemetry/instrumentation.ts`
- [x] T006 [P] Implement exporter resolution logic (jsonl, otlp) in `packages/agent-sdk/src/telemetry/instrumentation.ts`
- [x] T007 [P] Implement `shutdownTelemetry()` with flush timeout in `packages/agent-sdk/src/telemetry/instrumentation.ts`
- [x] T008 [P] Implement config resolution from env vars + settings.json in `packages/agent-sdk/src/telemetry/instrumentation.ts`
- [x] T009 [P] Unit tests for instrumentation in `packages/agent-sdk/tests/telemetry/instrumentation.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - OTLP Exporter (Priority: P1) 🎯 MVP

**Goal**: Send telemetry to remote OTLP collectors (Jaeger, Grafana, Honeycomb).

**Independent Test**: Point at local Jaeger, run session, verify traces in UI.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T010 [P] [US1] Unit tests for sessionTracing in `packages/agent-sdk/tests/telemetry/sessionTracing.test.ts`
- [x] T011 [P] [US1] Unit tests for events in `packages/agent-sdk/tests/telemetry/events.test.ts`
- [ ] T012 [P] [US1] Integration test for OTLP export in `packages/agent-sdk/tests/integration/otel-otlp.test.ts`

### Implementation for User Story 1

- [x] T013 [US1] Implement `sessionTracing.ts` with startInteractionSpan, startLLMRequestSpan, startToolSpan APIs
- [x] T014 [US1] Implement AsyncLocalStorage context management for span nesting
- [x] T015 [US1] Implement stale span cleanup (30-min TTL eviction)
- [x] T016 [US1] Implement `events.ts` with logOTelEvent API and PII gates
- [x] T017 [US1] Add OTLP HTTP exporter configuration in `instrumentation.ts`
- [x] T018 [US1] Support OTEL_EXPORTER_OTLP_HEADERS in `instrumentation.ts`
- [x] T019 [US1] Integrate telemetry init into `Agent` in `packages/agent-sdk/src/agent.ts`
- [x] T020 [US1] Integrate telemetry shutdown into `Agent.destroy()` in `packages/agent-sdk/src/agent.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - JSONL File Exporter (Priority: P2)

**Goal**: Write telemetry to `~/.wave/telemetry.jsonl` — one JSON record per line, matching Wave's session file format.

**Independent Test**: Run with `OTEL_*_EXPORTER=jsonl`, verify structured JSONL output in `~/.wave/telemetry.jsonl`.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T021 [P] [US2] Integration test for JSONL file exporter in `packages/agent-sdk/tests/integration/otel-jsonl.test.ts`

### Implementation for User Story 2

- [x] T022 [US2] Implement custom JSONL exporters (JsonlSpanExporter, JsonlMetricExporter, JsonlLogExporter) in `instrumentation.ts`
- [x] T023 [US2] Wire JSONL exporter to `~/.wave/telemetry.jsonl` with append-mode file writes

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: User Story 3 - Event Logging Integration (Priority: P2)

**Goal**: Structured event logs for session lifecycle integrated into agent operations.

**Independent Test**: Run with `OTEL_LOGS_EXPORTER=otlp`, complete session with compaction, verify events in collector.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T026 [P] [US3] Integration test for event logging in `packages/agent-sdk/tests/integration/otel-events.test.ts`

### Implementation for User Story 3

- [x] T027 [US3] Add session_start/session_end events in `Agent` in `packages/agent-sdk/src/agent.ts`
- [x] T028 [US3] Wrap `sendAIMessage()` with interaction + LLM spans in `AIManager` in `packages/agent-sdk/src/managers/aiManager.ts`
- [x] T029 [US3] Wrap `execute()` with tool spans in `ToolManager` in `packages/agent-sdk/src/managers/toolManager.ts`
- [x] T030 [US3] Add compaction events in `AIManager.handleTokenUsageAndCompaction()` in `packages/agent-sdk/src/managers/aiManager.ts`
- [x] T031 [US3] Add tool_decision events in `AIManager.executePreToolUseHooks()` + user_prompt/error events in `sendAIMessage()`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T032 [P] Add error boundaries around all telemetry operations (graceful degradation)
- [ ] T033 [P] Ensure `agent-sdk` is built and all packages are linked
- [x] T034 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [ ] T035 Run `quickstart.md` validation scenarios manually

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup (Phase 1).
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2). OTLP is the MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2). JSONL file exporter.
- **User Story 3 (Phase 5)**: Depends on Foundational (Phase 2). Event logging integration.
- **Polish (Final Phase)**: Depends on all user stories.

### Parallel Opportunities

- T002, T003, T004 (Setup types + deps)
- T006, T007, T008, T009 (Foundational sub-tasks)
- T010, T011 (US1 Tests)
- T012, T013, T014, T015 (US1 implementation)

## Phase 7: User Identification

- [ ] Implement anonymous ID fallback for telemetry when SSO not authenticated
