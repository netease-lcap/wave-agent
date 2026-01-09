# Tasks: SDK Env Headers Support

**Feature Name**: SDK Env Headers Support
**Feature Branch**: `041-sdk-env-headers`
**Implementation Plan**: [plan.md](plan.md)

## Phase 1: Setup

- [x] T001 Verify `packages/agent-sdk` build and test environment by running `pnpm build` and `pnpm test`

## Phase 2: Foundational

- (None)

## Phase 3: User Story 1 - Configure SDK Headers via Environment Variables

**Goal**: Support setting HTTP headers via the `WAVE_CUSTOM_HEADERS` environment variable.
**Independent Test Criteria**: Set `WAVE_CUSTOM_HEADERS="X-Test: 123"`, call `Agent.create()`, and verify `getGatewayConfig().defaultHeaders` contains the header.

- [x] T002 [P] [US1] Implement `parseCustomHeaders` utility in `packages/agent-sdk/src/utils/stringUtils.ts`
- [x] T003 [P] [US1] Create unit tests for `parseCustomHeaders` in `packages/agent-sdk/tests/utils/stringUtils.test.ts`
- [x] T004 [US1] Update `ConfigurationService.resolveGatewayConfig` to include headers from `WAVE_CUSTOM_HEADERS` in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T005 [US1] Add integration test for `Agent` with `WAVE_CUSTOM_HEADERS` in `packages/agent-sdk/tests/agent/agent.headers.test.ts`

## Phase 4: User Story 2 - Multi-line Header Support

**Goal**: Ensure multiple headers separated by newlines in `WAVE_CUSTOM_HEADERS` are correctly parsed and applied.
**Independent Test Criteria**: Set `WAVE_CUSTOM_HEADERS="A: 1\nB: 2"`, call `Agent.create()`, and verify both headers are present in the resolved configuration.

- [x] T006 [US2] Add multi-line test cases to `packages/agent-sdk/tests/utils/stringUtils.test.ts`
- [x] T007 [US2] Add multi-line integration test in `packages/agent-sdk/tests/agent/agent.headers.test.ts`

## Phase 5: Authentication Flexibility (FR-007, FR-008)

**Goal**: Remove mandatory apiKey validation to allow alternative auth via custom headers.
**Independent Test Criteria**: Call `Agent.create()` without an `apiKey` but with a custom auth header, and verify no validation error is thrown.

- [x] T010 [FR-007] Remove mandatory `apiKey` validation in `ConfigurationService`
- [x] T011 [FR-008] Update `Agent` initialization tests to verify success without `apiKey`
- [x] T012 Replace OpenAI SDK with custom fetch-based implementation to skip internal apiKey validation

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T008 Run `pnpm run type-check` and `pnpm lint` in `packages/agent-sdk`
- [x] T009 Run all tests in `packages/agent-sdk` to ensure no regressions

## Dependencies

- US1 is foundational for US2.
- T002 and T003 can be done in parallel.
- T004 depends on T002.
- T005 depends on T004.

## Parallel Execution Examples

### User Story 1
- `typescript-expert`: T002 Implement `parseCustomHeaders`
- `vitest-expert`: T003 Create unit tests for `parseCustomHeaders`

## Implementation Strategy

1. **MVP First**: Focus on US1 to get basic header support working.
2. **Incremental Delivery**: US2 adds support for multiple headers in a single variable.
3. **Quality First**: Ensure unit tests cover edge cases (malformed lines, empty values) before integration.
