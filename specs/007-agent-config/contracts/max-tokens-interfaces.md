# API Contracts: Configurable Max Output Tokens

## TypeScript Interfaces

### AgentOptions (packages/agent-sdk/src/agent.ts)
```typescript
export interface AgentOptions {
  // ... existing fields
  maxTokens?: number;
}
```

### CallAgentOptions (packages/agent-sdk/src/types.ts)
```typescript
export interface CallAgentOptions {
  // ... existing fields
  maxTokens?: number;
}
```

### ModelConfig (Internal)
```typescript
export interface ModelConfig {
  // ... existing fields
  maxTokens?: number;
}
```
