# Tool: CronDelete

## Description
Cancel a cron job previously scheduled with `CronCreate`. Removes it from the in-memory session store.

## Parameters
- **id**: `string` (Job ID returned by `CronCreate`)

## Returns
- **success**: `boolean` (Whether the job was successfully deleted)

## Example
```json
{
  "id": "loop_123abc"
}
```
