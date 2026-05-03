# Quickstart: Deferred Tool Loading

## What is Deferred Tool Loading?

Deferred tool loading saves context tokens by excluding rarely-used tools from the initial API call. Tools are only loaded when the AI model discovers them via `ToolSearch`.

## How It Works

1. **System prompt lists deferred tools by name** — you'll see a section like:
   ```
   <available-deferred-tools>CronCreate CronDelete WebFetch ...
   These tools are NOT loaded yet — call ToolSearch first to discover their schemas before invoking them.</available-deferred-tools>
   ```

2. **Discover a tool's schema** by calling `ToolSearch`:
   - Direct selection: `ToolSearch(query="select:CronCreate")`
   - Keyword search: `ToolSearch(query="schedule reminder")`
   - Required terms: `ToolSearch(query="+cron create")`

3. **Use the discovered tool** — once `ToolSearch` returns the schema, call the tool normally.

## Example Flow

```
User: Schedule a reminder to check the build every 5 minutes

AI: [Calls ToolSearch with query="select:CronCreate"]
    → Gets CronCreate schema
    [Calls CronCreate with cron="*/5 * * * *", prompt="check the build"]
    → Reminder scheduled successfully!
```

## Which Tools Are Deferred?

Common deferred tools include:
- Cron tools: `CronCreate`, `CronDelete`, `CronList`
- Web tools: `WebFetch`
- Worktree tools: `EnterWorktree`, `ExitWorktree`
- Task tools: `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`, `TaskStop`
- All MCP tools (automatically deferred)

## Benefits

- **More context tokens** available for conversation
- **Reduced risk** of context overflow
- **Faster responses** (smaller API payloads)
