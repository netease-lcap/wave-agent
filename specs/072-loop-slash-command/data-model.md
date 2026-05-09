# Data Model: /loop Slash Command & Cron Tools

## Entities

### CronJob
Represents a scheduled task in the current session.

- **id**: `string` (Unique identifier returned by `CronCreate`)
- **cron**: `string` (Standard 5-field cron expression)
- **prompt**: `string` (The prompt or command to be executed when the job fires)
- **recurring**: `boolean` (Whether the job should repeat or fire once)
- **createdAt**: `number` (Timestamp when the job was created, used for 7-day expiration)
- **nextRun**: `number` (Timestamp of the next scheduled execution, including jitter)
- **periodMs**: `number` (The duration between executions in milliseconds, used for recurring jitter calculation)
- **durable**: `boolean | undefined` (When `true`, the job is persisted to `.wave/scheduled_tasks.json` and survives Wave restarts. When `undefined` or `false`, the job is session-only and dies when Wave exits.)
- **lastFiredAt**: `number | undefined` (For recurring durable tasks, tracks the last fire time so `nextRun` survives process restarts)

## Relationships
- **CronManager** maintains a `Map<string, CronJob>` of all active jobs in the session.
- **CronJob** is created by `CronCreate` and removed by `CronDelete` or auto-expiration.
- Durable jobs are also persisted to `<workdir>/.wave/scheduled_tasks.json` and synced on mutations.

## Storage

### Session-only jobs
Live only in the in-memory `CronManager.jobs` map. Lost on process exit.

### Durable jobs
Persisted to `<workdir>/.wave/scheduled_tasks.json` with format:
```json
{ "tasks": [{ id, cron, prompt, createdAt, lastFiredAt?, recurring?, durable? }] }
```
Runtime-only fields (`nextRun`, `periodMs`) are stripped before writing.

## Scheduler Lock
To prevent double-firing when multiple Wave sessions run in the same project, durable tasks require a scheduler lease lock at `<workdir>/.wave/scheduled_tasks.lock`. Only the lock-owning session fires durable jobs. Non-owners probe every 5s and take over if the owner's process dies.

## Validation Rules
- **Cron Expression**: Must be a valid 5-field cron string.
- **Prompt**: Cannot be empty.
- **Interval**: Minimum granularity is 1 minute. Seconds are rounded up.
- **Expiration**: Recurring jobs MUST be deleted after 7 days.
- **Idle Check**: Jobs MUST NOT fire if `AIManager.isLoading` is `true`.
- **Lock Gating**: Durable jobs MUST NOT fire unless the session holds the scheduler lock.
