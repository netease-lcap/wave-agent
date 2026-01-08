# Research: Configurable Max Output Tokens for Agent

## Findings

### 1. Configuration Flow
- `Agent.create` takes `AgentOptions`.
- `Agent` class uses `ConfigurationService` to resolve settings.
- `AIManager` is initialized with getters for configuration.
- `AIManager` calls `aiService.callAgent` with resolved configuration.

### 2. Environment Variables
- `ConfigurationService` handles environment variables.
- `WAVE_API_KEY` and `WAVE_BASE_URL` are already supported.
- `WAVE_MAX_OUTPUT_TOKENS` should be added to `ConfigurationService.getEnvironmentVars()`.

### 3. AI Provider Integration
- The SDK uses the `openai` package.
- The parameter name for max tokens in OpenAI's `chat.completions.create` is `max_tokens`.
- For Claude models (if supported via OpenAI-compatible gateway), `max_tokens` is also standard.

### 4. Precedence Logic
- The precedence should be: `callAgent` arg > `Agent` options > Environment variable > Default (4096).
- This logic should be implemented in `AIManager` or `Agent` class when resolving the final configuration for a call.

## Decisions

- **Decision**: Add `maxTokens` to `AgentOptions` and `CallAgentOptions`.
- **Rationale**: Consistent with existing options like `apiKey` and `baseURL`.
- **Decision**: Use `max_tokens` when calling OpenAI.
- **Rationale**: Matches the OpenAI API specification used by the SDK.
- **Decision**: Default to 4096.
- **Rationale**: Sensible default for most LLM tasks while preventing runaway costs.

## Alternatives Considered

- **Alternative**: Only support environment variable.
- **Rejected**: Too restrictive; developers need per-agent or per-call control.
- **Alternative**: Use different parameter names for different providers.
- **Rejected**: The SDK currently abstracts providers through an OpenAI-compatible interface.
