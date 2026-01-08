# Feature Specification: Agent Constructor Configuration

**Feature Branch**: `004-agent-constructor-config`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "agent sdk remove process.env.xxx, change to pass them through Agent.create constructor args. remember the vitest ci NODE_ENV WAVE_TEST_HOOKS_EXECUTION those testing related envs are not needed to change."

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

Developers need to configure custom token limits through the Agent constructor to control message compression behavior without setting environment variables.

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

### Edge Cases

- What happens when partial configuration is provided (e.g., apiKey but no baseURL)?
- How does system handle invalid configuration values (empty strings, malformed URLs)?
- What occurs when both constructor args and environment variables are present?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Agent constructor MUST accept optional `apiKey` string parameter with fallback to WAVE_API_KEY environment variable
- **FR-002**: Agent constructor MUST accept optional `baseURL` string parameter with fallback to WAVE_BASE_URL environment variable
- **FR-003**: Agent constructor MUST accept optional `agentModel` string parameter with fallback to WAVE_MODEL environment variable
- **FR-004**: Agent constructor MUST accept optional `fastModel` string parameter with fallback to WAVE_FAST_MODEL environment variable
- **FR-005**: Agent constructor MUST accept optional `maxInputTokens` number parameter with fallback to WAVE_MAX_INPUT_TOKENS environment variable
- **FR-006**: System MUST validate resolved configuration and throw clear errors for missing/invalid values
- **FR-007**: System MUST prioritize constructor-provided values over environment variables when both exist
- **FR-008**: System MUST preserve existing environment variable behavior for testing-related variables (NODE_ENV, VITEST, WAVE_TEST_HOOKS_EXECUTION)
- **FR-009**: Service MUST use resolved configuration instead of direct process.env access
- **FR-010**: System MUST provide reasonable defaults for optional configuration values when neither constructor nor environment values exist

### Key Entities *(include if feature involves data)*

- **AgentConfig**: Flattened configuration parameters directly in AgentOptions (apiKey, baseURL, agentModel, fastModel, maxInputTokens)
- **GatewayConfig**: Resolved configuration for gateway service including authentication and endpoint details
- **ModelConfig**: Resolved model selection configuration specifying which models to use for different operations

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can create fully configured Agent instances using optional constructor parameters
- **SC-002**: Agent creation falls back to environment variables when constructor parameters not provided
- **SC-003**: Agent creation fails with descriptive error messages when required configuration is missing from both sources
- **SC-004**: Constructor parameters override environment variables when both are present
- **SC-005**: Testing-related environment variables (NODE_ENV, VITEST, WAVE_TEST_HOOKS_EXECUTION) continue to work as before
- **SC-006**: Service uses resolved configuration instead of direct environment variable access
- **SC-006**: Code no longer directly accesses AI-related environment variables (WAVE_API_KEY, WAVE_BASE_URL, WAVE_MODEL, etc.)