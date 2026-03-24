# Configuration API Contract (Updated)

## WaveConfiguration Interface

```typescript
export interface WaveConfiguration {
  // ... existing fields
  /** Preferred language for agent communication */
  language?: string;
}
```

## AgentOptions Interface

```typescript
export interface AgentOptions {
  // ... existing fields
  /** Optional preferred language */
  language?: string;
}
```

## ConfigurationService Methods

### `resolveLanguage(constructorLanguage?: string): string | undefined`
Resolves the language to use based on priority:
1. `constructorLanguage`
2. `this.currentConfiguration.language`
3. Default: `undefined` (no prompt added)
