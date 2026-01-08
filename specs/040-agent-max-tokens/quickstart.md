# Quickstart: Configurable Max Output Tokens

## Usage Examples

### 1. Using Environment Variable
Set the environment variable before running your agent:
```bash
export WAVE_MAX_OUTPUT_TOKENS=2048
```

### 2. Using Agent Options
Specify `maxTokens` when creating the agent:
```typescript
const agent = await Agent.create({
  apiKey: 'your-api-key',
  maxTokens: 1024
});
```

### 3. Overriding in callAgent
Override the limit for a specific call:
```typescript
const response = await agent.callAgent(messages, {
  maxTokens: 512
});
```

## Precedence
1. `callAgent` options
2. `Agent.create` options
3. `WAVE_MAX_OUTPUT_TOKENS` environment variable
4. Default (4096)
