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

## Relationships
- **CronManager** maintains a `Map<string, CronJob>` of all active jobs in the session.
- **CronJob** is created by `CronCreate` and removed by `CronDelete` or auto-expiration.

## Validation Rules
- **Cron Expression**: Must be a valid 5-field cron string.
- **Prompt**: Cannot be empty.
- **Interval**: Minimum granularity is 1 minute. Seconds are rounded up.
- **Expiration**: Recurring jobs MUST be deleted after 7 days.
- **Idle Check**: Jobs MUST NOT fire if `AIManager.isLoading` is `true`.
