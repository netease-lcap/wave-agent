# Data Model: Agent Constructor Configuration

**Generated**: 2025-01-27  
**Feature**: Agent Constructor Configuration

## Configuration Entities

### AgentOptions Interface
Extended interface for Agent constructor parameters.

**Fields**:
- `apiKey?: string` - Gateway API key (optional, fallback to WAVE_API_KEY)
- `baseURL?: string` - Gateway endpoint URL (optional, fallback to WAVE_BASE_URL)
- `agentModel?: string` - Model ID for main operations (optional, fallback to WAVE_MODEL)
- `fastModel?: string` - Model ID for fast operations (optional, fallback to WAVE_FAST_MODEL)
- `maxInputTokens?: number` - Token limit for compression (optional, fallback to WAVE_MAX_INPUT_TOKENS, default: 96000)
- `callbacks?: AgentCallbacks` - Existing callback handlers
- `restoreSessionId?: string` - Existing session restoration
- `continueLastSession?: boolean` - Existing session continuation
- `logger?: Logger` - Existing logger instance
- `messages?: Message[]` - Existing initial messages
- `workdir?: string` - Existing working directory
- `systemPrompt?: string` - Existing custom system prompt

**Validation Rules**:
- If neither constructor arg nor environment variable provided for apiKey/baseURL, Agent creation fails
- `maxInputTokens` must be positive integer if provided
- All existing validation rules preserved

### GatewayConfig Interface
Resolved configuration for gateway service connection.

**Fields**:
- `apiKey: string` - Authentication token for gateway (resolved from constructor or env)
- `baseURL: string` - Gateway endpoint URL (resolved from constructor or env)

**Validation Rules**:
- `apiKey` must be non-empty string after resolution
- `baseURL` must be valid URL format after resolution
- Both fields required after fallback resolution

**Relationships**:
- Used by Service to establish OpenAI client connection
- Passed through Agent → Manager → Service chain
- Resolved from constructor args with environment fallbacks

### ModelConfig Interface  
Resolved configuration for model selection.

**Fields**:
- `agentModel: string` - Model ID for main operations (resolved from constructor, env, or default)
- `fastModel: string` - Model ID for compression and fast operations (resolved from constructor, env, or default)

**Validation Rules**:
- Model IDs must be non-empty strings after resolution
- No format validation (service validates model availability)

**Default Values**:
- `agentModel`: "claude-sonnet-4-20250514"
- `fastModel`: "gemini-2.5-flash"

**Relationships**:
- Used by Service for model selection in API calls
- Replaces direct constant usage from utils/constants.ts

## Configuration Resolution

### Resolution Chain
Configuration values resolved in this order:

1. **Constructor Parameters** (highest precedence)
   - `AgentOptions.apiKey`
   - `AgentOptions.baseURL`
   - `AgentOptions.agentModel`
   - `AgentOptions.fastModel`
   - `AgentOptions.maxInputTokens`

2. **Environment Variables** (fallback)
   - `process.env.WAVE_API_KEY` → `apiKey`
   - `process.env.WAVE_BASE_URL` → `baseURL`
   - `process.env.WAVE_MODEL` → `agentModel`
   - `process.env.WAVE_FAST_MODEL` → `fastModel`
   - `process.env.WAVE_MAX_INPUT_TOKENS` → `maxInputTokens`

3. **Built-in Defaults** (lowest precedence)
   - Token limit: 96000
   - Agent model: "claude-sonnet-4-20250514"
   - Fast model: "gemini-2.5-flash"

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
- Missing apiKey: No constructor arg and no WAVE_API_KEY environment variable
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