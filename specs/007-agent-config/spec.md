# Feature Specification: Agent Configuration

**Feature Branch**: `007-agent-config`  
**Created**: 2025-01-27  
**Input**: User description: "agent sdk remove process.env.xxx, change to pass them through Agent.create constructor args. remember the vitest ci NODE_ENV WAVE_TEST_HOOKS_EXECUTION those testing related envs are not needed to change. Also support max output tokens, custom headers from env, and language setting."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Explicit AI Service Configuration (Priority: P1)

Developers need to configure AI gateway settings (API key, base URL, model IDs) explicitly through the Agent constructor instead of relying on environment variables, providing better control and testability.

**Why this priority**: This is the core functionality that enables explicit configuration management and improves API usability by making required configuration visible and controllable.

**Independent Test**: Can be fully tested by creating an Agent instance with custom AI configuration and verifying it uses those settings instead of environment variables.

**Acceptance Scenarios**:

1. **Given** a developer creates an Agent with custom AI configuration, **When** the agent processes messages, **Then** it uses the provided configuration values
2. **Given** no configuration is provided to Agent constructor, **When** environment variables are set, **Then** agent uses environment variable values

---

### User Story 2 - Token Limit Configuration (Priority: P2)

Developers need to configure custom token limits through the Agent constructor to control message compression behavior and maximum output tokens without setting environment variables.

**Why this priority**: Token limit configuration affects performance and cost management but is secondary to basic AI functionality.

**Independent Test**: Can be tested independently by creating an Agent with custom token limit and verifying compression triggers at the specified limit.

**Acceptance Scenarios**:

1. **Given** a developer sets a custom token limit via Agent constructor, **When** token usage exceeds that limit, **Then** message compression is triggered
2. **Given** no token limit is provided, **When** agent is created, **Then** it uses a reasonable default token limit

---

### User Story 3 - Model Selection Configuration (Priority: P3)

Developers need to specify default AI models (agent model and fast model) through the Agent constructor to avoid hardcoded model dependencies on environment variables.

**Why this priority**: Model configuration provides flexibility but is tertiary to core functionality as default models can work for most use cases.

**Independent Test**: Can be tested by creating an Agent with custom model configuration and verifying the specified models are used for AI operations.

**Acceptance Scenarios**:

1. **Given** a developer specifies custom models via Agent constructor, **When** AI operations are performed, **Then** the specified models are used instead of defaults

---

### User Story 4 - Configurable Max Output Tokens (Priority: P2)

As a developer, I want to specify the maximum output tokens for AI responses via environment variables, agent creation options, or direct call arguments.

**Why this priority**: Essential for controlling response lengths and costs.

**Independent Test**: Set `WAVE_MAX_OUTPUT_TOKENS=2048` or pass `maxTokens: 1024` to `Agent.create` and verify the AI service call uses the correct limit.

**Acceptance Scenarios**:

1. **Given** `WAVE_MAX_OUTPUT_TOKENS` is set to `2048`, **When** `callAgent` is invoked, **Then** the request uses 2048 as the max token limit.
2. **Given** an agent is created with `maxTokens: 1024`, **When** `callAgent` is invoked, **Then** the request uses 1024 as the max token limit.

---

### User Story 5 - SDK Custom Headers via Environment Variables (Priority: P2)

As a developer, I want to configure custom HTTP headers for the SDK using the `WAVE_CUSTOM_HEADERS` environment variable to manage authentication or environment-specific metadata.

**Why this priority**: Enables alternative authentication methods and better security practices.

**Independent Test**: Set `WAVE_CUSTOM_HEADERS="X-Test: 123\nY-Test: 456"`, initialize the SDK, and verify outgoing requests include these headers.

**Acceptance Scenarios**:

1. **Given** `WAVE_CUSTOM_HEADERS` is set to `X-Test: 123`, **When** the SDK makes a request, **Then** it includes the header `X-Test: 123`.
2. **Given** no `apiKey` is provided but a custom auth header is set in `WAVE_CUSTOM_HEADERS`, **When** the SDK is initialized, **Then** it does not throw a validation error.

---

### User Story 6 - Configure Preferred Language (Priority: P1)

As a user, I want to specify my preferred language in the settings file or via agent options so that the agent communicates with me in that language.

**Why this priority**: Enables non-English speakers to interact with the agent more effectively.

**Independent Test**: Set `language: "Chinese"` in `Agent.create()` or `settings.json` and verify the system prompt contains the language instruction.

**Acceptance Scenarios**:

1. **Given** the language is set to "Chinese", **When** I ask the agent a question, **Then** the agent responds in Chinese.
2. **Given** the language is set to "Spanish", **When** the agent explains a function `calculateTotal()`, **Then** the explanation is in Spanish but `calculateTotal()` remains unchanged.

---

### User Story 7 - Custom Environment Variables (Priority: P1)

A developer needs to pass custom environment variables (API keys, database URLs, feature flags) to their Wave Agent SDK without hardcoding them in their code. They add an "env" field to their settings.json file and expect these variables to be available in their agent execution context. The Wave Code CLI will inherit this functionality since it uses the SDK.

**Why this priority**: This provides essential configuration flexibility and follows security best practices by keeping sensitive data in configuration files rather than code.

**Independent Test**: Can be fully tested by adding env variables to settings.json and verifying they are accessible in agent processes, delivering immediate configuration value.

**Acceptance Scenarios**:

1. **Given** a settings.json file with env field containing key-value pairs, **When** Wave Agent SDK is started, **Then** those environment variables are available to all agent processes
2. **Given** both user-level and project-level settings.json files with env fields, **When** an agent runs, **Then** project-level env variables override user-level ones with the same name
3. **Given** an env field with invalid format, **When** settings are loaded, **Then** system shows clear error message about invalid environment variable configuration

---

### User Story 8 - Live Settings Reload (Priority: P2)

A developer is actively working and needs to modify their settings.json configuration (hooks, environment variables, etc.). They want these changes to take effect immediately without restarting the SDK, enabling rapid iteration on their configuration. The Wave Code CLI will benefit from this since it uses the SDK.

**Why this priority**: Eliminates workflow disruption and improves developer productivity by removing restart requirements for configuration changes.

**Independent Test**: Can be tested by modifying settings.json while CLI/SDK is running and verifying new configuration takes effect on next operation.

**Acceptance Scenarios**:

1. **Given** Wave Agent SDK is running, **When** user modifies settings.json, **Then** changes are detected and applied to subsequent operations without restart
2. **Given** Wave Agent SDK is processing requests, **When** settings.json is updated, **Then** new settings are used for the next agent execution
3. **Given** invalid settings are saved, **When** file watcher detects changes, **Then** system logs error but continues with previous valid configuration

---

### Edge Cases

- What happens when partial configuration is provided (e.g., apiKey but no baseURL)?
- How does system handle invalid configuration values (empty strings, malformed URLs, non-numeric token limits)?
- What occurs when both constructor args and environment variables are present?
- How are malformed lines in `WAVE_CUSTOM_HEADERS` handled? (They should be ignored).
- What happens when settings.json contains malformed JSON during live reload?
- How does system handle file system permission errors during file watching?
- How does system handle rapid consecutive file modifications?
- What happens when file watchers fail to initialize on system startup?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Agent constructor MUST accept optional `apiKey` string parameter with fallback to `WAVE_API_KEY` environment variable.
- **FR-002**: Agent constructor MUST accept optional `baseURL` string parameter with fallback to `WAVE_BASE_URL` environment variable.
- **FR-003**: Agent constructor MUST accept optional `model` string parameter with fallback to `WAVE_MODEL` environment variable.
- **FR-004**: Agent constructor MUST accept optional `fastModel` string parameter with fallback to `WAVE_FAST_MODEL` environment variable.
- **FR-005**: Agent constructor MUST accept optional `maxInputTokens` number parameter with fallback to `WAVE_MAX_INPUT_TOKENS` environment variable.
- **FR-006**: System MUST validate resolved configuration and throw clear errors for missing/invalid values.
- **FR-007**: System MUST prioritize constructor-provided values over environment variables when both exist.
- **FR-008**: System MUST preserve existing environment variable behavior for testing-related variables (`NODE_ENV`, `VITEST`, `WAVE_TEST_HOOKS_EXECUTION`).
- **FR-009**: Service MUST use resolved configuration instead of direct `process.env` access.
- **FR-010**: System MUST provide reasonable defaults for optional configuration values when neither constructor nor environment values exist.
- **FR-011**: `callAgent` MUST accept a `maxTokens` parameter in its options argument, defaulting to 4096.
- **FR-012**: System MUST read `WAVE_MAX_OUTPUT_TOKENS` environment variable for default max output tokens.
- **FR-013**: Precedence for `maxTokens` MUST be: `callAgent` arg > `Agent.create` options > `WAVE_MAX_OUTPUT_TOKENS` > Default (4096).
- **FR-014**: SDK MUST read `WAVE_CUSTOM_HEADERS` environment variable, splitting by newlines and parsing as `Key: Value` pairs.
- **FR-015**: SDK MUST NOT enforce the presence of an `apiKey` during initialization if alternative auth is provided via custom headers.
- **FR-016**: System MUST support setting `language` via `AgentOptions` or `settings.json`.
- **FR-017**: System MUST inject a language instruction into the system prompt if a language is configured, following the specified format.
- **FR-018**: `AgentOptions` and `ModelConfig` MUST support arbitrary additional properties to allow model-specific parameters (e.g., `temperature`, `reasoning_effort`, `thinking`).
- **FR-019**: System MUST support model-specific overrides in `settings.json` via a `models` field.
- **FR-020**: System MUST allow unsetting default parameters by setting them to `null` in the configuration.
- **FR-021**: settings.json MUST support an optional "env" field containing key-value pairs of environment variables
- **FR-022**: System MUST merge user-level and project-level env configurations, with project-level taking precedence
- **FR-023**: System MUST validate env field format and show clear errors for invalid configurations
- **FR-024**: System MUST watch settings.json files for changes and reload configuration automatically
- **FR-025**: System MUST continue operating with previous valid configuration when invalid changes are detected
- **FR-026**: System MUST log configuration reload events and errors appropriately
- **FR-027**: File watchers MUST handle file deletion, creation, and modification events
- **FR-028**: Environment variables from env field MUST be available to hook processes and agent execution context
- **FR-029**: System MUST handle file watcher initialization failures by throwing descriptive error and preventing SDK startup
- **FR-030**: System MUST reset permissions (allow, deny, additionalDirectories) to empty arrays and permissionMode to undefined when they are missing in the new configuration during reload

### Key Entities *(include if feature involves data)*

- **AgentConfig**: Flattened configuration parameters directly in `AgentOptions` (apiKey, baseURL, model, fastModel, maxInputTokens, maxTokens, language).
- **GatewayConfig**: Resolved configuration for gateway service including authentication, endpoint details, and custom headers.
- **ModelConfig**: Resolved model selection configuration specifying which models to use for different operations.
- **Settings Configuration**: Contains hooks, env variables, and other configuration options, watched for changes
- **File Watcher**: Monitors configuration files and triggers reload events
- **Environment Context**: Merged environment variables from user and project settings, passed to agent processes

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can create fully configured Agent instances using optional constructor parameters.
- **SC-002**: Agent creation falls back to environment variables when constructor parameters not provided.
- **SC-003**: Agent creation fails with descriptive error messages when required configuration is missing from both sources (except for `apiKey` when custom headers are present).
- **SC-004**: Constructor parameters override environment variables when both are present.
- **SC-005**: Testing-related environment variables continue to work as before.
- **SC-006**: Service uses resolved configuration instead of direct environment variable access.
- **SC-007**: `maxTokens` is correctly applied to AI service calls with proper precedence.
- **SC-008**: Custom headers from `WAVE_CUSTOM_HEADERS` are included in outgoing requests.
- **SC-009**: Agent responds in the configured language while preserving technical terms.
