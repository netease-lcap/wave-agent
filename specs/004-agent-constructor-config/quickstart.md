# Configuration API Usage Examples

## Basic Agent Creation with Configuration

```typescript
import { Agent } from '@wave-agent/agent-sdk';

// All configuration options are optional - fallback to environment variables
const agent = await Agent.create({
  apiKey: 'your-api-key-here',
  baseURL: 'https://your-gateway.com',
  agentModel: 'claude-sonnet-4-20250514',
  fastModel: 'gemini-2.5-flash',
  tokenLimit: 50000,
  workdir: './project'
});
```

## Minimal Configuration (Using Environment Variables)

```typescript
// No constructor config - uses environment variables
// Requires AIGW_TOKEN and AIGW_URL environment variables
const agent = await Agent.create({
  workdir: './project'
  // apiKey: uses AIGW_TOKEN
  // baseURL: uses AIGW_URL  
  // tokenLimit: uses TOKEN_LIMIT or defaults to 64000
  // models: use AIGW_MODEL, AIGW_FAST_MODEL or built-in defaults
});
```

## Mixed Configuration (Partial Override)

```typescript
// Some explicit, some from environment
const agent = await Agent.create({
  apiKey: 'explicit-key',        // Overrides AIGW_TOKEN
  // baseURL uses AIGW_URL environment variable
  agentModel: 'custom-model',    // Overrides AIGW_MODEL
  // fastModel uses AIGW_FAST_MODEL or default
  tokenLimit: 32000,             // Overrides TOKEN_LIMIT
  workdir: './project'
});
```

## Testing Configuration

```typescript
import { Agent } from '@wave-agent/agent-sdk';

// Test with mock configuration
const testAgent = await Agent.create({
  apiKey: 'test-api-key',
  baseURL: 'http://localhost:3000/mock-ai',
  agentModel: 'test-model',
  fastModel: 'test-fast-model',
  tokenLimit: 1000, // Lower limit for testing
  messages: [], // Start with empty messages
});
```

## Error Handling

```typescript
try {
  // Missing both constructor args and environment variables
  const agent = await Agent.create({
    workdir: './project'
    // No apiKey provided and AIGW_TOKEN not set
    // No baseURL provided and AIGW_URL not set
  });
} catch (error) {
  // Error: "Gateway configuration requires apiKey. Provide via constructor or AIGW_TOKEN environment variable."
  console.error(error.message);
}

try {
  const agent = await Agent.create({
    apiKey: '', // Empty string
    baseURL: 'https://api.example.com'
  });
} catch (error) {
  // Error: "API key cannot be empty string."
  console.error(error.message);
}

try {
  const agent = await Agent.create({
    apiKey: 'valid-key',
    tokenLimit: -1000 // Invalid token limit
  });
} catch (error) {
  // Error: "Token limit must be a positive integer."
  console.error(error.message);
}
```

## Backward Compatibility - Environment Variables

```typescript
// Existing code continues to work if environment variables are set
// AIGW_TOKEN=token, AIGW_URL=url, etc.
const legacyAgent = await Agent.create({
  workdir: './project',
  logger: console
  // Uses environment variables for all configuration
});

// New code can override specific environment variables
const modernAgent = await Agent.create({
  apiKey: 'explicit-key',     // Overrides AIGW_TOKEN
  baseURL: 'https://new-url', // Overrides AIGW_URL
  // Other config uses environment variables
  workdir: './project',
  logger: console
});
```

## Configuration Precedence Examples

```typescript
// Environment: AIGW_TOKEN=env-key, AIGW_URL=env-url, AIGW_MODEL=env-model

// Constructor values override environment
const agent1 = await Agent.create({
  apiKey: 'constructor-key',     // Uses constructor value
  baseURL: 'constructor-url',    // Uses constructor value
  // agentModel uses AIGW_MODEL from environment
});

// Partial override example  
const agent2 = await Agent.create({
  apiKey: 'constructor-key',     // Overrides AIGW_TOKEN
  // baseURL uses AIGW_URL from environment
  // models use environment variables or defaults
});

// Environment only
const agent3 = await Agent.create({
  workdir: './project'
  // All config from environment variables
});
```

## Advanced Configuration

```typescript
// Environment-aware configuration with explicit overrides
const agent = await Agent.create({
  apiKey: process.env.PRODUCTION_API_KEY || 'fallback-key',
  baseURL: process.env.NODE_ENV === 'production' 
    ? 'https://prod-gateway.com'
    : 'https://dev-gateway.com',
  agentModel: process.env.NODE_ENV === 'production'
    ? 'claude-sonnet-4-20250514'
    : 'gemini-2.5-flash', // Cheaper model for development
  fastModel: 'gemini-2.5-flash',
  tokenLimit: process.env.NODE_ENV === 'production' ? 64000 : 10000,
  workdir: process.cwd(),
  logger: customLogger
});
```