# Tool: CronCreate

## Description
Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

## Parameters
- **cron**: `string` (Standard 5-field cron expression in local time: "M H DoM Mon DoW")
- **prompt**: `string` (The prompt to enqueue at each fire time)
- **recurring**: `boolean` (Default: `true`. `true` = fire on every cron match until deleted or auto-expired after 7 days. `false` = fire once at the next match, then auto-delete)
- **durable**: `boolean` (Default: `false`. `true` = persist job to `.wave/scheduled_tasks.json` so it survives Wave restarts. `false` = session-only, removed when Wave exits.)

## Returns
- **id**: `string` (Unique job ID for cancellation)

## Example
```json
{
  "cron": "*/5 * * * *",
  "prompt": "check the build",
  "recurring": true,
  "durable": false
}
```
