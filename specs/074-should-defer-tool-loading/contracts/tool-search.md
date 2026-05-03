# Contract: ToolSearch Tool

## Tool Definition

```typescript
{
  type: "function",
  function: {
    name: "ToolSearch",
    description: "Fetches full schema definitions for deferred tools so they can be called.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Query to find deferred tools. Use "select:ToolName" for direct selection, or keywords to search.'
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
          default: 5
        }
      },
      required: ["query"]
    }
  }
}
```

## Query Formats

### Direct Selection
```
select:ToolName           → Single tool
select:Tool1,Tool2        → Multiple tools (comma-separated)
```

### Keyword Search
```
cron                      → Search by keyword
schedule reminder         → Multi-keyword search (ranked)
+cron create              → Required: "cron" must match; rank by "create"
```

## Response Format

### Success
```
ToolName: Description text
Parameters: {
  "type": "object",
  "properties": {...},
  "required": [...]
}

---

ToolName2: Description text
Parameters: {...}
```

### Short Result (for streaming)
```
Discovered tools: CronCreate, CronDelete
```
or
```
Found 2 tools: CronCreate, CronDelete
```

### Error
```json
{
  "success": false,
  "content": "",
  "error": "No matching deferred tools found for: InvalidTool"
}
```

## Scoring Algorithm

1. **Exact name match** → Return immediately (fast path)
2. **Partition terms** → `+prefix` = required, others = optional
3. **Pre-filter** → Only tools matching ALL required terms
4. **Score** each remaining tool:
   - Exact part match: MCP=12, built-in=10
   - Partial part match: MCP=6, built-in=5
   - Full name fallback: 3
   - Description match: 2
5. **Sort** by score descending, limit to `max_results`
