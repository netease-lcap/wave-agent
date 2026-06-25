# Configuration API Usage Examples

## Basic Agent Creation with Configuration

```typescript
import { Agent } from 'wave-agent-sdk';

// All configuration options are optional - fallback to environment variables
const agent = await Agent.create({
  apiKey: 'your-api-key-here',
  baseURL: 'https://your-gateway.com',
  model: 'gemini-3-flash',
  fastModel: 'gemini-2.5-flash',
  maxInputTokens: 50000,
  maxTokens: 2048,
  language: 'Chinese',
  workdir: './project'
});
```

## Minimal Configuration (Using Environment Variables)

```typescript
// No constructor config - uses environment variables
// Requires WAVE_API_KEY and WAVE_BASE_URL environment variables
const agent = await Agent.create({
  workdir: './project'
  // apiKey: uses WAVE_API_KEY
  // baseURL: uses WAVE_BASE_URL  
  // maxInputTokens: uses WAVE_MAX_INPUT_TOKENS or defaults to 96000
  // maxTokens: uses WAVE_MAX_OUTPUT_TOKENS or defaults to 4096
  // models: use WAVE_MODEL, WAVE_FAST_MODEL or built-in defaults
});
```

## Custom Headers via Environment Variables

```bash
# Set custom headers in environment
export WAVE_CUSTOM_HEADERS="X-Custom-Id: 123\nAuthorization: Bearer custom-token"
```

```typescript
// SDK will automatically include these headers in all requests
const agent = await Agent.create({ workdir: './project' });
```

## Language Setting (settings.json)

```json
{
  "language": "Spanish"
}
```

```typescript
// Agent will automatically respond in Spanish
const agent = await Agent.create({ workdir: './project' });
```

## Direct Call Override for Max Tokens

```typescript
// Override maxTokens for a specific call
const result = await agent.callAgent({
  messages: [{ role: 'user', content: 'Write a long story' }],
  maxTokens: 8192
});
```

## Mixed Configuration (Partial Override)

```typescript
// Some explicit, some from environment
const agent = await Agent.create({
  apiKey: 'explicit-key',        // Overrides WAVE_API_KEY
  // baseURL uses WAVE_BASE_URL environment variable
  model: 'custom-model',    // Overrides WAVE_MODEL
  // fastModel uses WAVE_FAST_MODEL or default
  maxInputTokens: 32000,             // Overrides WAVE_MAX_INPUT_TOKENS
  maxTokens: 1024,                   // Overrides WAVE_MAX_OUTPUT_TOKENS
  workdir: './project'
});
```

## Error Handling

```typescript
try {
  // Missing both constructor args and environment variables
  const agent = await Agent.create({
    workdir: './project'
    // No apiKey provided and WAVE_API_KEY not set
    // No baseURL provided and WAVE_BASE_URL not set
  });
} catch (error) {
  // Error: "Gateway configuration requires apiKey. Provide via constructor or WAVE_API_KEY environment variable."
  console.error(error.message);
}

try {
  const agent = await Agent.create({
    apiKey: 'valid-key',
    maxTokens: -1000 // Invalid token limit
  });
} catch (error) {
  // Error: "Token limit must be a positive integer."
  console.error(error.message);
}
```

## Configuration Precedence Examples

```typescript
// Environment: WAVE_API_KEY=env-key, WAVE_BASE_URL=env-url, WAVE_MODEL=env-model, WAVE_MAX_OUTPUT_TOKENS=2048

// Constructor values override environment
const agent1 = await Agent.create({
  apiKey: 'constructor-key',     // Uses constructor value
  baseURL: 'constructor-url',    // Uses constructor value
  maxTokens: 1024,               // Uses constructor value
  // model uses WAVE_MODEL from environment
});

// Direct call overrides everything
const result = await agent1.callAgent({
  maxTokens: 512 // Uses 512 for this call only
});
```
