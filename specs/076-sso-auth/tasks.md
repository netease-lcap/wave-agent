# Tasks: SSO Authentication

**Input**: Design documents from `/specs/076-sso-auth/`
**Prerequisites**: spec.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality.

**Organization**: Tasks grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Auth Types & Service)

**Purpose**: Auth types, AuthService, and core SSO infrastructure

- [x] T001 [P] [US1] Create `AuthConfig` type in `packages/agent-sdk/src/types/auth.ts`
- [x] T002 [P] [US1] Export auth types from `packages/agent-sdk/src/types/index.ts`
- [x] T003 [P] [US1] Create `AuthService` in `packages/agent-sdk/src/services/authService.ts` with:
  - `getAuthPath()`, `loadAuth()`, `saveAuth()`, `clearAuth()`
  - `getSSOToken()`, `isSSOAuthenticated()`, `getServerUrl()`
  - `login()` with browser SSO flow
  - `startLocalAuthServer()` with localhost callback
  - `openBrowser()` using `execFile` for security
- [x] T004 [P] [US1] Export `AuthService` and `authService` singleton from `packages/agent-sdk/src/index.ts`

---

## Phase 2: Configuration Integration (US3)

**Purpose**: Wire SSO mode into gateway configuration resolution

**⚠️ CRITICAL**: This enables API routing — all user stories depend on this

- [x] T005 [US3] Add `readSSOToken()` private method to `ConfigurationService` in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T006 [US3] Update `resolveGatewayConfig()` to check SSO token first, returning `{ apiKey: SSO_TOKEN, baseURL: ${WAVE_SERVER_URL}/api/v1 }` when present
- [ ] T007 [US3] Unit tests for SSO mode resolution in `packages/agent-sdk/tests/services/configurationService.test.ts`

**Checkpoint**: SSO API routing works — agent can use SSO token for LLM requests.

---

## Phase 3: User Story 1 - Browser SSO Login (Priority: P1) 🎯 MVP

**Goal**: `/login` opens browser, receives callback, saves token.

**Independent Test**: Set `WAVE_SERVER_URL`, run Wave locally, type `/login`, browser opens, complete SSO, verify token saved.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T008 [P] [US1] Unit tests for AuthService in `packages/agent-sdk/tests/services/authService.test.ts`

### Implementation for User Story 1

- [x] T009 [US1] Add `/login` and `/logout` entries to `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts`
- [x] T010 [US1] Add `showLoginCommand` state + `SET_SHOW_LOGIN_COMMAND` action in `packages/code/src/managers/inputReducer.ts`
- [x] T011 [US1] Add `login`/`logout` command handlers + `setShowLoginCommand` in `packages/code/src/hooks/useInputManager.ts`
- [x] T012 [US1] Create `LoginCommand` component in `packages/code/src/components/LoginCommand.tsx`
- [x] T013 [US1] Integrate `LoginCommand` into `InputBox` in `packages/code/src/components/InputBox.tsx`
- [x] T014 [US1] Update `inputReducer.test.ts` to include `showLoginCommand` in initial state

**Checkpoint**: At this point, `/login` opens browser, saves token, and API routes through Wave AI.

---

## Phase 4: User Story 2 - Manual Token Input (Priority: P1)

**Goal**: Support pasting token from browser URL bar when callback cannot reach CLI (remote servers).

**Independent Test**: SSH to remote server, `/login`, open URL locally, copy token from URL bar, paste into terminal.

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] T015 [P] [US2] Unit tests for manual token input in `packages/agent-sdk/tests/services/authService.test.ts`

### Implementation for User Story 2

- [x] T016 [US2] Update `AuthService.login()` to accept `readToken?: () => Promise<string>` option
- [x] T017 [US2] Race between server callback and `readToken()` in `startLocalAuthServer()` — first to resolve wins
- [x] T018 [US2] Update `LoginCommand` to use Ink `useInput` for token accumulation (handle paste chunks)
- [x] T019 [US2] Display auth URL + token input field when loading in `LoginCommand`

**Checkpoint**: At this point, both local browser and remote server flows work.

---

## Phase 5: User Story 3 - Automatic SSO API Routing (Priority: P1)

**Goal**: SSO token automatically routes API requests through Wave AI proxy.

**Independent Test**: Login via SSO, send message, verify API goes to Wave AI.

**Note**: Most implementation for US3 was completed in Phase 2 (T005-T006). This phase verifies integration.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T020 [P] [US3] Integration test for SSO API routing in `packages/agent-sdk/tests/integration/sso-api-routing.test.ts`

### Verification for User Story 3

- [ ] T021 [US3] Verify `callAgent()` uses SSO `gatewayConfig` when `SSO_TOKEN` is present
- [ ] T022 [US3] Verify `compactMessages()`, `processWebContent()`, `btw()` all use SSO `gatewayConfig`

**Checkpoint**: At this point, all three user stories are complete and independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Security, error handling, and quality gates

- [x] T023 [P] Ensure browser opening uses `execFile` with args array (not `exec` with string interpolation)
- [x] T024 [P] Add `settled` flag to prevent double-resolution in auth server
- [x] T025 [P] Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [x] T026 [P] Run `pnpm test` — all existing tests must pass
- [ ] T027 Manual test: local browser flow, remote server paste flow, logout flow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Configuration Integration (Phase 2)**: Depends on Setup (Phase 1). Required before all user stories.
- **User Story 1 (Phase 3)**: Depends on Setup (Phase 1) and Configuration (Phase 2). Browser SSO login.
- **User Story 2 (Phase 4)**: Depends on Setup (Phase 1) and Configuration (Phase 2). Manual token input.
- **User Story 3 (Phase 5)**: Depends on Configuration Integration (Phase 2). SSO API routing verification.
- **Polish (Final Phase)**: Depends on all user stories.
- **Token Expiration (Phase 7)**: Depends on Setup (Phase 1) and Configuration (Phase 2). Proactive refresh + reactive 401 recovery.

### Parallel Opportunities

- T001, T002 (Setup types)
- T003, T004 (AuthService creation + export)
- T008, T009, T010, T011 (US1 tests + CLI commands)
- T015, T016, T017 (US2 tests + AuthService update)

---

## Phase 7: Token Expiration & Refresh (Issue #1137)

**Purpose**: Proactive token refresh, reactive 401 recovery, multi-process safety

- [x] T028 [US3] Extend `AuthConfig` type with `SSO_REFRESH_TOKEN`, `SSO_TOKEN_EXPIRES_AT` and add `TokenResponse` type in `packages/agent-sdk/src/types/auth.ts`
- [x] T029 [US3] Add token refresh methods to `AuthService` in `packages/agent-sdk/src/services/authService.ts`:
  - `isTokenExpired()`, `checkAndRefreshTokenIfNeeded()`, `refreshToken()`, `tryReadRefreshedTokenFromDisk()`
  - `_refreshPromise` (401 dedup), `_authFileMtime` (multi-process), `REFRESH_BUFFER_MS` (5-min)
  - Update `exchangeCode()` endpoint to `/api/auth/token` with `grant_type`
  - Update `login()` to save `SSO_REFRESH_TOKEN`, `SSO_TOKEN_EXPIRES_AT`
  - Update `isSSOAuthenticated()` to check strict expiry
  - Update `clearAuth()` to delete new fields
  - Update `saveAuth()`/`loadAuth()` to track mtime
- [x] T030 [US3] Create `createAuthAwareFetch()` export in `packages/agent-sdk/src/services/authService.ts`
- [x] T031 [US3] Integrate auth-aware fetch into `resolveGatewayConfig()` SSO branch in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T032 [US3] Integrate auth-aware fetch into `fetchRemoteSettings()` in `packages/agent-sdk/src/services/remoteSettingsService.ts`
- [x] T033 [US3] Update and add tests in `packages/agent-sdk/tests/services/authService.test.ts`:
  - Update exchange endpoint URL/body assertions
  - `isTokenExpired`, `checkAndRefreshTokenIfNeeded`, `refreshToken`, `clearAuth` new fields
  - `createAuthAwareFetch` proactive refresh, 401 recovery, header updates
  - `isSSOAuthenticated` with expiry
- [x] T034 [US3] Update `remoteSettingsService.test.ts` authService mock with `createAuthAwareFetch` and `checkAndRefreshTokenIfNeeded`

**Checkpoint**: Tokens refresh automatically before expiry, 401 errors are recovered transparently, multi-process safe.

---

## Phase 8: Auth Observability & Configuration Gaps

**Purpose**: Audit logging, authAwareFetch reliability, and serverUrl resolution

- [ ] Add info-level `[Auth]` logging to token refresh flow
- [ ] Always create authAwareFetch in SSO mode regardless of fetch argument
- [ ] Add serverUrl option to AuthService.login() with priority chain
