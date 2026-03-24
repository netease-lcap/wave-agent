# Quickstart: /loop Slash Command

The `/loop` command is the quickest way to schedule a recurring prompt. Pass an optional interval and a prompt, and Agent sets up a cron job that fires in the background while the session stays open.

## Usage

```bash
/loop [interval] <prompt>
```

### Examples

- **Every 5 minutes**: `/loop 5m check the build`
- **Every 2 hours**: `/loop check the build every 2h`
- **Default (10 minutes)**: `/loop check the build`
- **Daily at midnight**: `/loop 1d /echo "Good morning!"`

## Interval Syntax

Intervals are optional. You can lead with them, trail with them, or leave them out entirely.

| Form | Example | Parsed Interval |
|------|---------|-----------------|
| Leading token | `/loop 30m check the build` | every 30 minutes |
| Trailing "every" clause | `/loop check the build every 2 hours` | every 2 hours |
| No interval | `/loop check the build` | defaults to every 10 minutes |

Supported units are `s` (seconds), `m` (minutes), `h` (hours), and `d` (days). Seconds are rounded up to the nearest minute since cron has one-minute granularity.

## Managing Jobs

When you schedule a job, Agent will provide a **Job ID**. You can use this ID to cancel the job later.

### How to Cancel

To stop a recurring task, simply ask Agent to cancel it using its ID:

```bash
cancel job loop_123abc
```

### Auto-Expiration

All recurring tasks automatically expire and are deleted after **7 days** to keep your session clean.

## Notes

- Jobs only fire when Agent is **idle** (not currently processing another message).
- If an interval doesn't divide evenly into its unit (e.g., `7m` or `90m`), Agent will round it to the nearest clean interval and let you know.
