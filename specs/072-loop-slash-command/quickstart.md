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
- **Daily at midnight**: `/loop 1d check the build status`

## Interval Syntax

Intervals are optional. You can specify them as a leading token (e.g., `5m`), a trailing "every" clause (e.g., `every 2h`), or leave them out entirely (defaults to 10 minutes).

Supported units are `s` (seconds), `m` (minutes), `h` (hours), and `d` (days).

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
