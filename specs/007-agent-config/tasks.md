# Tasks: Agent Configuration ✅ COMPLETE

**Status**: All tasks completed successfully - Feature ready for production

**Input**: Design documents from `/specs/007-agent-config/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Agent SDK Package**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- All paths relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and configuration interfaces

- [x] T001 Create configuration interfaces in `packages/agent-sdk/src/types.ts`
- [x] T002 [P] Create configuration resolver utilities in `packages/agent-sdk/src/utils/configResolver.ts`
- [x] T003 [P] Create configuration validator utilities in `packages/agent-sdk/src/utils/configValidator.ts`
- [x] T004 Update `WaveConfiguration` interface to include `language?: string` in `packages/agent-sdk/src/types/configuration.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core configuration infrastructure that MUST be complete before ANY user story can be implemented

- [x] T005 Update `AgentOptions` interface in `packages/agent-sdk/src/agent.ts` to include optional configuration parameters
- [x] T006 Implement configuration resolution logic in `packages/agent-sdk/src/utils/configResolver.ts`
- [x] T007 Implement configuration validation logic in `packages/agent-sdk/src/utils/configValidator.ts`
- [x] T008 Create `ConfigurationError` class and error constants in `packages/agent-sdk/src/types.ts`
- [x] T009 Implement `resolveLanguage(constructorLanguage?: string): string | undefined` in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T010 Implement `parseCustomHeaders` utility in `packages/agent-sdk/src/utils/stringUtils.ts`

---

## Phase 3: User Story 1 - Explicit AI Service Configuration (Priority: P1) 🎯 MVP

**Goal**: Enable developers to configure AI gateway settings (API key, base URL) through Agent constructor with environment variable fallbacks

- [x] T011 [US1] Update `Agent.create` method in `packages/agent-sdk/src/agent.ts` to resolve gateway configuration from constructor args and environment variables
- [x] T012 [US1] Update `AIManager` constructor in `packages/agent-sdk/src/managers/aiManager.ts` to accept resolved `GatewayConfig`
- [x] T013 [US1] Update `AIService` constructor in `packages/agent-sdk/src/services/aiService.ts` to use injected `GatewayConfig` instead of `process.env`
- [x] T014 [US1] Remove direct `process.env` access for `WAVE_API_KEY` and `WAVE_BASE_URL` from `packages/agent-sdk/src/services/aiService.ts`
- [x] T015 [US1] Add configuration validation and error handling for missing gateway configuration in `Agent.create` method

---

## Phase 4: User Story 2 - Token Limit Configuration (Priority: P2)

**Goal**: Enable developers to configure custom token limits through Agent constructor to control message compression behavior

- [x] T016 [P] [US2] Update `Agent.create` method in `packages/agent-sdk/src/agent.ts` to resolve `maxInputTokens` from constructor args, environment variables, or defaults
- [x] T017 [US2] Update `AIManager` constructor in `packages/agent-sdk/src/managers/aiManager.ts` to accept resolved `maxInputTokens` parameter
- [x] T018 [US2] Remove direct `process.env.WAVE_MAX_INPUT_TOKENS` access from `packages/agent-sdk/src/managers/aiManager.ts`
- [x] T019 [US2] Update token limit validation logic to use resolved configuration in `packages/agent-sdk/src/utils/configValidator.ts`
- [x] T020 [US2] Update message compression logic to use injected `maxInputTokens` in `packages/agent-sdk/src/managers/aiManager.ts`

---

## Phase 5: User Story 3 - Model Selection Configuration (Priority: P3)

**Goal**: Enable developers to specify AI models (agent model and fast model) through the Agent constructor instead of environment variables

- [x] T021 [P] [US3] Update `Agent.create` method in `packages/agent-sdk/src/agent.ts` to resolve model configuration from constructor args, environment variables, or defaults
- [x] T022 [US3] Update `AIManager` constructor in `packages/agent-sdk/src/managers/aiManager.ts` to accept resolved `ModelConfig`
- [x] T023 [US3] Update `AIService` to use injected `ModelConfig` instead of constants from `packages/agent-sdk/src/utils/constants.ts`
- [x] T024 [US3] Remove direct `process.env` access for `WAVE_MODEL` and `WAVE_FAST_MODEL` from `packages/agent-sdk/src/utils/constants.ts`
- [x] T025 [US3] Update model selection logic in `packages/agent-sdk/src/services/aiService.ts` to use injected configuration

---

## Phase 6: User Story 4 - Configurable Max Output Tokens (Priority: P2)

**Goal**: Allow setting the global token limit via `WAVE_MAX_OUTPUT_TOKENS` and overriding it at agent creation or call time.

- [x] T026 [US4] Update `ConfigurationService` to read `WAVE_MAX_OUTPUT_TOKENS` environment variable
- [x] T027 [US4] Update `Agent` class to handle `maxTokens` in constructor and provide a getter
- [x] T028 [US4] Update `AIManager` to resolve `maxTokens` with correct precedence and pass it to `aiService`
- [x] T029 [US4] Update `callAgent` in `packages/agent-sdk/src/services/aiService.ts` to use `maxTokens` from options when calling OpenAI

---

## Phase 7: User Story 5 - SDK Custom Headers via Environment Variables (Priority: P2)

**Goal**: Support setting HTTP headers via the `WAVE_CUSTOM_HEADERS` environment variable.

- [x] T030 [US5] Update `ConfigurationService.resolveGatewayConfig` to include headers from `WAVE_CUSTOM_HEADERS` in `packages/agent-sdk/src/services/configurationService.ts`
- [x] T031 [US5] Remove mandatory `apiKey` validation in `ConfigurationService`
- [x] T032 [US5] Replace OpenAI SDK with custom fetch-based implementation to skip internal `apiKey` validation

---

## Phase 8: User Story 6 - Configure Preferred Language (Priority: P1)

**Goal**: Support setting language via `AgentOptions` or `settings.json` and injecting it into the system prompt.

- [x] T033 [US6] Implement language instruction injection in `AIManager.sendAIMessage` within `packages/agent-sdk/src/managers/aiManager.ts`
- [x] T034 [US6] Update `Agent.resolveAndValidateConfig` to handle language if needed in `packages/agent-sdk/src/agent.ts`

---

## Phase 9: Polish & Cross-Cutting Concerns ✅ COMPLETE

**Purpose**: Testing, validation, and quality improvements across all user stories

- [x] T035 [P] Create comprehensive configuration tests in `packages/agent-sdk/tests/agent/agent.config.test.ts`
- [x] T036 [P] Update existing `AIService` tests in `packages/agent-sdk/tests/services/aiService.test.ts` to use configuration injection
- [x] T037 [P] Add integration test for `Agent` with `WAVE_CUSTOM_HEADERS` in `packages/agent-sdk/tests/agent/agent.headers.test.ts`
- [x] T038 [P] Integration test for prompt injection in `packages/agent-sdk/tests/managers/aiManager.test.ts`
- [x] T039 Build `agent-sdk` package to ensure TypeScript compilation
- [x] T040 Run type-check validation across `agent-sdk` package
- [x] T041 Run lint validation across `agent-sdk` package
- [x] T042 Validate `quickstart.md` examples work with new configuration API

---

## Tasks: Live Configuration Reload ✅ COMPLETE

- [x] T001 Add Chokidar dependency to packages/agent-sdk/package.json
- [x] T002 [P] Install development dependencies @types/chokidar in packages/agent-sdk/package.json
- [x] T003 [P] Build agent-sdk package to prepare for modifications
- [x] T004 Rename HookConfiguration to WaveConfiguration in packages/agent-sdk/src/types/hooks.ts
- [x] T005 [P] Add env field to WaveConfiguration interface in packages/agent-sdk/src/types/hooks.ts
- [x] T006 [P] Create FileWatcherService class structure in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T008 Update hook service imports to use WaveConfiguration in packages/agent-sdk/src/services/hook.ts
- [x] T009 Update all existing references from HookConfiguration to WaveConfiguration across the codebase
- [x] T010 [P] [US1] Implement env field validation in packages/agent-sdk/src/services/hook.ts
- [x] T011 [P] [US1] Create EnvironmentValidationResult interface in packages/agent-sdk/src/types/environment.ts
- [x] T012 [P] [US1] Implement environment variable validation logic using EnvironmentValidationResult in packages/agent-sdk/src/services/hook.ts
- [x] T013 [US1] Implement loadWaveConfigFromFile function to replace loadHooksConfigFromFile in packages/agent-sdk/src/services/hook.ts
- [x] T014 [US1] Implement mergeEnvironmentConfig function in packages/agent-sdk/src/services/hook.ts
- [x] T015 [US1] Add environment merging logic with project precedence in packages/agent-sdk/src/services/hook.ts
- [x] T016 [US1] Update loadMergedHooksConfig to loadMergedWaveConfig in packages/agent-sdk/src/services/hook.ts
- [x] T017 [US1] Update Agent constructor to use merged environment variables in packages/agent-sdk/src/agent.ts
- [x] T018 [US1] Add error handling for invalid env field format in packages/agent-sdk/src/services/hook.ts
- [x] T019 [P] [US2] Implement ConfigurationWatcher class in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T020 [P] [US2] Implement FileWatcherService with Chokidar integration in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T021 [US2] Add file watching initialization to LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T022 [US2] Implement configuration reload event handling in LiveConfigManager in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T023 [US2] Add debouncing and error recovery to file watcher in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T024 [US2] Update hook service to support live reload in packages/agent-sdk/src/services/hook.ts
- [x] T025 [US2] Add logging for configuration reload events in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T026 [US2] Implement graceful fallback when invalid configuration is detected in packages/agent-sdk/src/services/hook.ts
- [x] T027 [US2] Pass logger from Agent constructor to ConfigurationWatcher for structured logging in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T028 [US2] Add structured logging for reload events with Live Config prefix in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T029 [US2] Implement file watcher initialization failure handling with descriptive errors in packages/agent-sdk/src/services/fileWatcher.ts
- [x] T030 [US2] Reset permissions to empty arrays and permissionMode to undefined when missing in new configuration during reload in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T038 [P] Add comprehensive error logging with Live Config prefix across all services
- [x] T039 [P] Implement performance monitoring and metrics collection
- [x] T040 Code cleanup and refactoring for consistency
- [x] T041 [P] Add type safety improvements and remove any types
- [x] T042 [P] Update existing tests that use HookConfiguration to use WaveConfiguration
- [x] T043 Run quickstart.md validation examples
- [x] T044 Build and test agent-sdk package integration
