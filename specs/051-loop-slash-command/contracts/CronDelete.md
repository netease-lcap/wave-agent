# Tool: CronDelete

## Description
Cancel a cron job previously scheduled with `CronCreate`. Removes it from both the in-memory session store and durable file storage (if applicable).

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
