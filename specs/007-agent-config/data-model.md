# Data Model: Agent Configuration

**Generated**: 2025-01-27  
**Feature**: Agent Configuration

## Configuration Entities

### AgentOptions Interface
Extended interface for Agent constructor parameters.

**Fields**:
- `apiKey?: string` - Gateway API key (optional, fallback to WAVE_API_KEY)
- `baseURL?: string` - Gateway endpoint URL (optional, fallback to WAVE_BASE_URL)
- `model?: string` - Model ID for main operations (optional, fallback to WAVE_MODEL)
- `fastModel?: string` - Model ID for fast operations (optional, fallback to WAVE_FAST_MODEL)
- `maxInputTokens?: number` - Token limit for compression (optional, fallback to WAVE_MAX_INPUT_TOKENS, default: 96000)
- `maxTokens?: number` - Max output tokens for AI responses (optional, fallback to WAVE_MAX_OUTPUT_TOKENS, default: 4096)
- `language?: string` - Preferred language for agent responses (optional, from options or settings.json)
- `callbacks?: AgentCallbacks` - Existing callback handlers
- `restoreSessionId?: string` - Existing session restoration
- `continueLastSession?: boolean` - Existing session continuation
- `logger?: Logger` - Existing logger instance
- `messages?: Message[]` - Existing initial messages
- `workdir?: string` - Existing working directory
- `systemPrompt?: string` - Existing custom system prompt
- `[key: string]: unknown` - Arbitrary additional model-specific parameters (e.g., `temperature`, `reasoning_effort`, `thinking`)

**Validation Rules**:
- If neither constructor arg nor environment variable provided for apiKey/baseURL, Agent creation fails (unless custom headers provide auth)
- `maxInputTokens` and `maxTokens` must be positive integers if provided
- All existing validation rules preserved

### GatewayConfig Interface
Resolved configuration for gateway service connection.

**Fields**:
- `apiKey: string` - Authentication token for gateway (resolved from constructor or env)
- `baseURL: string` - Gateway endpoint URL (resolved from constructor or env)
- `defaultHeaders: Record<string, string>` - Custom HTTP headers (resolved from WAVE_CUSTOM_HEADERS)

**Validation Rules**:
- `baseURL` must be valid URL format after resolution
- `apiKey` is optional if `defaultHeaders` contains alternative authentication

**Relationships**:
- Used by Service to establish OpenAI client connection
- Passed through Agent → Manager → Service chain
- Resolved from constructor args with environment fallbacks

### ModelConfig Interface  
Resolved configuration for model selection.

**Fields**:
- `model: string` - Model ID for main operations (resolved from constructor, env, or default)
- `fastModel: string` - Model ID for compression and fast operations (resolved from constructor, env, or default)
- `maxTokens: number` - Max output tokens for AI responses
- `[key: string]: unknown` - Arbitrary additional model-specific parameters (e.g., `temperature`, `reasoning_effort`, `thinking`)

**Validation Rules**:
- Model IDs must be non-empty strings after resolution
- No format validation (service validates model availability)

**Default Values**:
- `model`: "gemini-3-flash"
- `fastModel`: "gemini-2.5-flash"
- `maxTokens`: 4096

**Relationships**:
- Used by Service for model selection in API calls
- Replaces direct constant usage from utils/constants.ts

### Wave Configuration (Live Reload)
**Purpose**: Complete configuration structure supporting environment variables and hooks  
**Location**: User and project `.wave/settings.json` files  
**Relationships**: Contains hook configuration and environment variables

```typescript
interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>; // Environment variables key-value pairs
}
```

**Validation Rules**:
- env field must be object with string keys and string values
- env field is optional (backward compatibility)
- JSON structure must be valid and parseable
- Individual environment variable names must follow standard naming conventions

## Configuration Resolution

### Resolution Chain
Configuration values resolved in this order:

1. **Constructor Parameters** (highest precedence)
   - `AgentOptions.apiKey`
   - `AgentOptions.baseURL`
   - `AgentOptions.model`
   - `AgentOptions.fastModel`
   - `AgentOptions.maxInputTokens`
   - `AgentOptions.maxTokens`
   - `AgentOptions.language`

2. **Environment Variables** (fallback)
   - `process.env.WAVE_API_KEY` → `apiKey`
   - `process.env.WAVE_BASE_URL` → `baseURL`
   - `process.env.WAVE_MODEL` → `model`
   - `process.env.WAVE_FAST_MODEL` → `fastModel`
   - `process.env.WAVE_MAX_INPUT_TOKENS` → `maxInputTokens`
   - `process.env.WAVE_MAX_OUTPUT_TOKENS` → `maxTokens`
   - `process.env.WAVE_CUSTOM_HEADERS` → `defaultHeaders`

3. **Built-in Defaults** (lowest precedence)
   - Token limit: 96000
   - Max output tokens: 4096
   - Agent model: "gemini-3-flash"
   - Fast model: "gemini-2.5-flash"

### Environment Variables (Live Reload)
**Purpose**: Key-value pairs for runtime environment configuration  
**Source**: env field in settings.json files  
**Relationships**: Merged from user and project configurations with precedence rules

**Structure**:
```typescript
interface EnvironmentContext {
  user: Record<string, string>;      // From ~/.wave/settings.json
  project: Record<string, string>;   // From ./.wave/settings.json  
  merged: Record<string, string>;    // Final merged result with project precedence
}
```

**Precedence Rules**:
1. Project-level variables override user-level variables with same name
2. Existing process environment variables are not overridden
3. Empty string values are treated as unset

### State Transitions

**Agent Creation Flow**:
```
Constructor Called → Validate Config → Resolve Values → Initialize Services → Ready
```

**Configuration Validation States**:
- `Valid`: All required configuration present and valid after resolution
- `Missing Required`: Gateway configuration incomplete after fallback resolution
- `Invalid Format`: Configuration values malformed

**Error States**:
- Missing apiKey: No constructor arg and no WAVE_API_KEY environment variable (and no custom auth headers)
- Missing baseURL: No constructor arg and no WAVE_BASE_URL environment variable
- Invalid token limit: Constructor throws with validation error

## Testing Entities

### MockAIServiceConfig
Test configuration for isolated testing.

**Fields**:
- `apiKey: "test-api-key"`
- `baseURL: "http://localhost:test"`

### ConfigurationTestCases
Standard test configurations for various scenarios.

**Constructor Only**: All parameters provided via constructor, no environment variables
**Environment Only**: No constructor config, all from environment variables
**Mixed Config**: Some parameters via constructor, others from environment fallback
**Invalid Config**: Missing required values in both constructor and environment for error testing
