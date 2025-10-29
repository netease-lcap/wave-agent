# Research: Agent Constructor Configuration

**Generated**: 2025-01-27  
**Feature**: Agent Constructor Configuration  
**Purpose**: Research technical decisions and best practices for configuration parameter design

## Configuration Interface Design

### Decision: Flattened Configuration Parameters
**Rationale**: Use a flat structure with optional parameters directly in AgentOptions to provide simple, intuitive configuration. This approach reduces nesting complexity and makes the API more discoverable.

**Alternatives considered**:
- Nested configuration objects: Rejected due to user preference for flattened structure
- Builder pattern: Rejected as overkill for simple configuration objects
- Function parameters: Rejected due to parameter explosion and poor extensibility

### Implementation Pattern:
```typescript
interface AgentOptions {
  // Existing options...
  // Flattened configuration parameters
  apiKey?: string;
  baseURL?: string;
  agentModel?: string;
  fastModel?: string;
  tokenLimit?: number;
}
```

## Configuration Precedence Strategy

### Decision: Optional Constructor with Environment Fallback
**Rationale**: All new configuration options are optional in the constructor. When not provided, the system falls back to environment variables. This maintains backward compatibility while enabling explicit configuration when desired.

**Alternatives considered**:
- Constructor-only: Rejected as it would be a breaking change
- Environment-only: Rejected as it doesn't meet the requirement for explicit configuration capability
- Required constructor config: Rejected due to user requirement that all options should be optional

### Implementation Pattern:
```typescript
interface AgentOptions {
  // All optional configuration with env fallbacks
  apiKey?: string;
  baseURL?: string;
  agentModel?: string;
  fastModel?: string;
  tokenLimit?: number;
  // ... existing options
}
```

## Validation Strategy

### Decision: Early Validation with Clear Error Messages  
**Rationale**: Validate configuration at Agent creation time to fail fast with descriptive errors. This prevents runtime failures and provides better developer experience.

**Alternatives considered**:
- Runtime validation: Rejected as it leads to delayed error discovery
- No validation: Rejected as it doesn't meet the requirement for clear error messages
- Schema validation libraries: Rejected as overkill for simple configuration objects

### Implementation Pattern:
```typescript
function validateGatewayConfig(apiKey?: string, baseURL?: string): void {
  const finalApiKey = apiKey || process.env.AIGW_TOKEN;
  const finalBaseURL = baseURL || process.env.AIGW_URL;
  
  if (!finalApiKey) {
    throw new Error('Gateway configuration requires apiKey. Provide via constructor or AIGW_TOKEN environment variable.');
  }
  if (!finalBaseURL) {
    throw new Error('Gateway configuration requires baseURL. Provide via constructor or AIGW_URL environment variable.');
  }
}
```

## Testing-Related Environment Variables

### Decision: Preserve Testing Environment Variables Unchanged
**Rationale**: NODE_ENV, VITEST, and WAVE_TEST_HOOKS_EXECUTION are development/testing infrastructure variables that should remain as environment-based configuration. These are not user-configurable settings but system-level controls.

**Implementation**: Continue to use process.env for these specific variables:
- `process.env.NODE_ENV`
- `process.env.VITEST` 
- `process.env.WAVE_TEST_HOOKS_EXECUTION`

## Configuration Injection Pattern

### Decision: Dependency Injection Through Constructor Chain
**Rationale**: Pass configuration values through the constructor chain from Agent → Manager → Service. Configuration is resolved once at the Agent level using constructor args with environment variable fallbacks.

**Alternatives considered**:
- Global configuration object: Rejected as it creates hidden dependencies
- Service locator pattern: Rejected as it obscures dependencies
- Per-service environment scanning: Rejected as it spreads configuration logic

### Implementation Flow:
1. Agent constructor receives optional configuration parameters
2. Agent resolves final configuration using constructor args + environment fallbacks
3. Agent passes resolved configuration to Manager constructors
4. Managers pass configuration to Services
5. Services use resolved configuration (no direct process.env access)

## Default Value Strategy

### Decision: Optional Constructor Args with Environment and Built-in Fallbacks
**Rationale**: Minimize breaking changes by making all new options optional. Provide clear fallback chain for maximum flexibility.

**Configuration Resolution Order**:
1. Constructor parameters (highest precedence)
2. Environment variables (fallback)
3. Built-in defaults (lowest precedence)

**Environment Variable Mapping**:
- `apiKey` ↔ `process.env.AIGW_TOKEN`
- `baseURL` ↔ `process.env.AIGW_URL`
- `agentModel` ↔ `process.env.AIGW_MODEL`
- `fastModel` ↔ `process.env.AIGW_FAST_MODEL`
- `tokenLimit` ↔ `process.env.TOKEN_LIMIT`

**Built-in Defaults**:
- Token limit: 64000
- Agent model: "claude-sonnet-4-20250514"
- Fast model: "gemini-2.5-flash"