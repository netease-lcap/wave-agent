---
name: loop
description: Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)
allowed-tools: CronCreate, Skill
user-invocable: true
---

# /loop — schedule a recurring prompt

Parse the input below into `[interval] <prompt…>` and schedule it with CronCreate.

## Usage

```
/loop [interval] <prompt>

Run a prompt or slash command on a recurring interval.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, defaults to 10m.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (defaults to 10m)
  /loop check the deploy every 20m
```

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches `^\d+[smhd]$` (e.g. `5m`, `2h`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with `every <N><unit>` or `every <N> <unit-word>` (e.g. `every 20m`, `every 5 minutes`, `every 2 hours`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — `check every PR` has no interval.
3. **Default**: otherwise, interval is `10m` and the entire input is the prompt.

If the resulting prompt is empty, show usage `/loop [interval] <prompt>` and stop — do not call CronCreate.

Examples:
- `5m /babysit-prs` → interval `5m`, prompt `/babysit-prs` (rule 1)
- `check the deploy every 20m` → interval `20m`, prompt `check the deploy` (rule 2)
- `run tests every 5 minutes` → interval `5m`, prompt `run tests` (rule 2)
- `check the deploy` → interval `10m`, prompt `check the deploy` (rule 3)
- `check every PR` → interval `10m`, prompt `check every PR` (rule 3 — "every" not followed by time)
- `5m` → empty prompt → show usage

## Interval → cron

Supported suffixes: `s` (seconds, rounded up to nearest minute, min 1), `m` (minutes), `h` (hours), `d` (days). Convert:

| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| `Nm` where N ≤ 59   | `*/N * * * *`     | every N minutes                          |
| `Nm` where N ≥ 60   | `0 */H * * *`     | round to hours (H = N/60, must divide 24)|
| `Nh` where N ≤ 23   | `0 */N * * *`     | every N hours                            |
| `Nd`                | `0 0 */N * *`     | every N days at midnight local           |
| `Ns`                | treat as `ceil(N/60)m` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. `7m` → `*/7 * * * *` gives uneven gaps at :56→:00; `90m` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.

## Avoid the :00 and :30 minute marks

When the user's request is approximate, pick a minute that is NOT 0 or 30:
- "every morning around 9" → `57 8 * * *` or `3 9 * * *` (not `0 9 * * *`)
- "hourly" → `7 * * * *` (not `0 * * * *`)

Only use minute 0 or 30 when the user names that exact time and clearly means it ("at 9:00 sharp", "at half past").

## Action

1. Call CronCreate with:
   - `cron`: the expression from the table above
   - `prompt`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - `recurring`: `true`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after 7 days, and that they can cancel sooner with CronDelete (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, run it directly; otherwise act on it directly.

## Input

$ARGUMENTS
