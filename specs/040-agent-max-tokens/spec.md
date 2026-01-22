# Feature Specification: Configurable Max Output Tokens for Agent

**Feature Branch**: `040-agent-max-tokens`  
**Created**: 2026-01-08  
**Status**: Implemented  
**Input**: User description: "packages/agent-sdk/src/services/aiService.ts callAgent should take max tokens from arg like baseUrl and apiKey, default is 4096, support env var WAVE_MAX_OUTPUT_TOKENS and agent.create options"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default Token Limit (Priority: P1)

As a developer, I want the agent to have a sensible default for the maximum number of output tokens so that I don't have to configure it for basic use cases.

**Why this priority**: Essential for out-of-the-box functionality and preventing infinite or excessively long responses by default.

**Independent Test**: Can be tested by creating an agent without any specific token configuration and verifying that the underlying AI service call uses 4096 as the limit.

**Acceptance Scenarios**:

1. **Given** no `maxTokens` is specified in code or environment, **When** `callAgent` is invoked, **Then** the request to the AI service should include a max token limit of 4096.

---

### User Story 2 - Environment Variable Configuration (Priority: P2)

As a system administrator or developer, I want to be able to set the maximum output tokens globally via an environment variable so that I can control costs or response lengths across multiple agents without changing code.

**Why this priority**: Provides a convenient way to manage limits across different environments (dev, staging, prod) without code changes.

**Independent Test**: Can be tested by setting `WAVE_MAX_OUTPUT_TOKENS` and verifying that agents use this value when not explicitly overridden in code.

**Acceptance Scenarios**:

1. **Given** `WAVE_MAX_OUTPUT_TOKENS` is set to `2048`, **When** an agent is created and `callAgent` is invoked without explicit token limits, **Then** the request should use 2048 as the max token limit.

---

### User Story 3 - Agent Creation Options (Priority: P2)

As a developer, I want to specify the maximum output tokens when creating an agent so that all calls made by that specific agent instance respect that limit.

**Why this priority**: Allows per-agent configuration which is common when different agents have different purposes (e.g., a "summarizer" vs. a "creative writer").

**Independent Test**: Can be tested by passing a `maxTokens` option to `agent.create` and verifying it is used in `callAgent`.

**Acceptance Scenarios**:

1. **Given** an agent is created with `maxTokens: 1024`, **When** `callAgent` is invoked, **Then** the request should use 1024 as the max token limit, even if `WAVE_MAX_OUTPUT_TOKENS` is set to something else.

---

### User Story 4 - Direct Call Override (Priority: P3)

As a developer, I want to override the maximum output tokens for a specific `callAgent` invocation so that I can handle one-off requests that need more or fewer tokens than the agent's default.

**Why this priority**: Provides the highest level of granularity and control for specific interactions.

**Independent Test**: Can be tested by passing a `maxTokens` argument directly to `callAgent` and verifying it takes precedence over all other configurations.

**Acceptance Scenarios**:

1. **Given** an agent with a default or configured limit, **When** `callAgent` is invoked with a specific `maxTokens` argument, **Then** that specific value must be used for that request.

---

### Edge Cases

- **What happens when `WAVE_MAX_OUTPUT_TOKENS` is set to a non-numeric value?** The system should fallback to the default (4096) and ideally log a warning.
- **What happens if `maxTokens` is set to 0 or a negative number?** The system should treat this as invalid and use the default or the next level of configuration.
- **What happens if the AI provider has a lower hard limit than the requested `maxTokens`?** The AI provider's limit will likely take precedence at the API level, but the SDK should pass the requested value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `callAgent` MUST accept a `maxTokens` parameter in its options argument.
- **FR-002**: `agent.create` MUST accept a `maxTokens` option in its configuration object.
- **FR-003**: The system MUST read the `WAVE_MAX_OUTPUT_TOKENS` environment variable.
- **FR-004**: The default value for maximum output tokens MUST be 4096 if not specified elsewhere.
- **FR-005**: The precedence for determining the max tokens value MUST be (from highest to lowest):
    1. `callAgent` argument
    2. `agent.create` options
    3. `WAVE_MAX_OUTPUT_TOKENS` environment variable
    4. Default value (4096)
- **FR-006**: The `maxTokens` value MUST be passed to the underlying AI service provider (e.g., OpenAI, Anthropic) in the appropriate field (e.g., `max_tokens` or `max_output_tokens`).

### Key Entities *(include if feature involves data)*

- **Agent Configuration**: The set of parameters (API key, base URL, max tokens, etc.) that define how an agent interacts with AI services.
- **AI Service Request**: The payload sent to the AI provider, which now includes the `maxTokens` limit.
