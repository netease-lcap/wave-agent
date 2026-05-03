# Data Model: Deferred Tool Loading

## ToolPlugin Interface Extensions

```typescript
interface ToolPlugin {
  // ... existing fields ...
  shouldDefer?: boolean;   // Tool excluded from API call until discovered
  alwaysLoad?: boolean;    // Tool always loaded (overrides shouldDefer)
  isMcp?: boolean;         // Tool from MCP server (auto-deferred)
}
```

## Discovery Tracking

```typescript
// AIManager field
private discoveredTools = new Set<string>();

// ToolManager filtering
getToolsConfig({ discoveredTools }: { discoveredTools?: Set<string> }): ToolConfig[]
```

## ToolSearch Query Formats

| Format | Example | Behavior |
|--------|---------|----------|
| `select:ToolName` | `select:CronCreate` | Direct selection by exact name |
| Keyword search | `schedule reminder` | Ranked by relevance scoring |
| Required terms | `+cron list` | Must match "cron"; rank by "list" |

## Scoring Weights

| Match Type | Built-in | MCP |
|------------|----------|-----|
| Exact part match | 10 pts | 12 pts |
| Partial part match | 5 pts | 6 pts |
| Full name fallback | 3 pts | 3 pts |
| Description match | 2 pts | 2 pts |
