# Tasks: Separate Agent Sessions

**Feature Branch**: `014-separate-agent-sessions`
**Status**: In Progress

## Phase 1: Setup

- [ ] T001 Verify build environment and dependencies in `packages/agent-sdk`

## Phase 2: Foundational (Session Service)

**Goal**: Update the core session service to support variable filename prefixes.
**Independent Test**: Unit tests for `session.ts` pass with various prefixes.

- [ ] T002 [P] Create/Update unit tests for `session.ts` to cover `prefix` parameter in `getSessionFilePath` and `saveSession` in `packages/agent-sdk/tests/services/session.test.ts`
- [ ] T003 [P] Update unit tests for `session.ts` to cover `listSessions` and `loadSession` with different prefixes in `packages/agent-sdk/tests/services/session.test.ts`
- [ ] T004 Implement `prefix` support in `getSessionFilePath` and `saveSession` in `packages/agent-sdk/src/services/session.ts`
- [ ] T005 Implement `prefix` support in `listSessions` and `loadSession` in `packages/agent-sdk/src/services/session.ts`

## Phase 3: User Story 1 (Distinguishable Session Files)

**Goal**: Configure Agent and Subagent to use different session filename prefixes.
**Independent Test**: Run `quickstart.md` verification steps; confirm `session_*.json` and `subagent_session_*.json` files are created.

### MessageManager Updates

- [X] T006 [P] [US1] Update `MessageManager` tests to verify `sessionPrefix` configuration in `packages/agent-sdk/tests/managers/messageManager.test.ts`
- [X] T007 [US1] Update `MessageManager` interface and class to support `sessionPrefix` in `packages/agent-sdk/src/managers/messageManager.ts`

### SubagentManager Updates

- [X] T008 [P] [US1] Update `SubagentManager` tests to verify subagent creation uses correct session prefix in `packages/agent-sdk/tests/managers/subagentManager.sessions.test.ts`
- [X] T009 [US1] Update `SubagentManager` to initialize subagent `MessageManager` with `subagent_session` prefix in `packages/agent-sdk/src/managers/subagentManager.ts`

### Verification

- [ ] T010 [US1] Verify fix by running the verification steps in `specs/014-separate-agent-sessions/quickstart.md`

## Phase 4: Polish

- [ ] T011 Run full test suite and linting for `packages/agent-sdk`

## Dependencies

1. **T004, T005** depend on **T002, T003** (TDD: Tests first)
2. **T007** depends on **T006** (TDD) and **T004** (Service layer ready)
3. **T009** depends on **T008** (TDD) and **T007** (MessageManager ready)

## Parallel Execution Examples

- **Tests**: T002, T003, T006, T008 can be written in parallel.
- **Implementation**: T004 and T005 can be implemented in parallel after tests are written.

## Implementation Strategy

1. **Foundation**: First, enable the capability to save/load with prefixes in the low-level service.
2. **Integration**: Then, expose this capability through `MessageManager`.
3. **Configuration**: Finally, configure `SubagentManager` to use this capability.
