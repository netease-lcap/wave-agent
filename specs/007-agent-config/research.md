# Research: Agent Configuration

**Generated**: 2025-01-27  
**Feature**: Agent Configuration  
**Purpose**: Research technical decisions and best practices for configuration parameter design

## Configuration Interface Design

### Decision: Flattened Configuration Parameters
**Rationale**: Use a flat structure with optional parameters directly in `AgentOptions` to provide simple, intuitive configuration. This approach reduces nesting complexity and makes the API more discoverable.

### Implementation Pattern:
```typescript
interface AgentOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  fastModel?: string;
  maxInputTokens?: number;
  maxTokens?: number;
  language?: string;
}
```

## Configuration Precedence Strategy

### Decision: Optional Constructor with Environment Fallback
**Rationale**: All new configuration options are optional in the constructor. When not provided, the system falls back to environment variables. This maintains backward compatibility while enabling explicit configuration when desired.

### Precedence for `maxTokens`:
1. `callAgent` argument (highest)
2. `Agent.create` options
3. `WAVE_MAX_OUTPUT_TOKENS` environment variable
4. Default value (4096) (lowest)

## Validation Strategy

### Decision: Early Validation with Clear Error Messages  
**Rationale**: Validate configuration at Agent creation time to fail fast with descriptive errors. This prevents runtime failures and provides better developer experience.

### Decision: Remove Mandatory `apiKey` Validation
**Rationale**: Users might provide authentication via custom headers in `WAVE_CUSTOM_HEADERS`. The SDK should not enforce `apiKey` presence if alternative auth is possible.

## Custom Headers Support

### Decision: Multi-line Environment Variable for Headers
**Rationale**: `WAVE_CUSTOM_HEADERS` will support multiple headers separated by newlines (`\n` or `\r\n`). Each line follows the `Key: Value` format.

## Language Setting and Prompt Injection

### Decision: System Prompt Injection for Language
**Rationale**: Inject a specific instruction block into the system prompt to ensure the agent follows the user's preferred language while preserving technical terms.

### Prompt Template:
```
# Language
Always respond in ${A}. Use ${A} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.
```

## Testing-Related Environment Variables

### Decision: Preserve Testing Environment Variables Unchanged
**Rationale**: `NODE_ENV`, `VITEST`, and `WAVE_TEST_HOOKS_EXECUTION` are development/testing infrastructure variables that should remain as environment-based configuration. These are not user-configurable settings but system-level controls.

## Configuration Injection Pattern

### Decision: Dependency Injection Through Constructor Chain
**Rationale**: Pass configuration values through the constructor chain from Agent → Manager → Service. Configuration is resolved once at the Agent level using constructor args with environment variable fallbacks.

## Default Value Strategy

### Decision: Optional Constructor Args with Environment and Built-in Fallbacks
**Rationale**: Minimize breaking changes by making all new options optional. Provide clear fallback chain for maximum flexibility.

**Environment Variable Mapping**:
- `apiKey` ↔ `process.env.WAVE_API_KEY`
- `baseURL` ↔ `process.env.WAVE_BASE_URL`
- `model` ↔ `process.env.WAVE_MODEL`
- `fastModel` ↔ `process.env.WAVE_FAST_MODEL`
- `maxInputTokens` ↔ `process.env.WAVE_MAX_INPUT_TOKENS`
- `maxTokens` ↔ `process.env.WAVE_MAX_OUTPUT_TOKENS`
- `headers` ↔ `process.env.WAVE_CUSTOM_HEADERS`

**Built-in Defaults**:
- Token limit: 96000
- Max output tokens: 4096
- Agent model: "gemini-3-flash"
- Fast model: "gemini-2.5-flash"
