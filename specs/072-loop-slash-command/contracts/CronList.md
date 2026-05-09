# Tool: CronList

## Description
List all cron jobs scheduled via `CronCreate` in this session. Includes both session-only and durable (file-backed) jobs.

## Parameters
- None

## Returns
- **jobs**: `Array<CronJob>` (List of active jobs in the session)
  - Each job includes a `scope` field: `"durable"` or `"session-only"`

## Example
```json
{}
```
