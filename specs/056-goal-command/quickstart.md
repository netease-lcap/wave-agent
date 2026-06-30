# Quickstart: /goal Command

The `/goal` command sets an autonomous completion condition for your session. Once set, the agent works across multiple turns without user input, evaluating after each turn whether the condition has been met.

## Usage

```bash
/goal <condition>       # Set a goal and start working
/goal                   # Show current goal status
/goal clear             # Cancel the active goal
```

### Examples

- **Make tests pass**: `/goal all tests in test/auth pass`
- **Fix a bug**: `/goal the login flow works end-to-end without errors`
- **Build a feature**: `/goal the user can sort the table by any column`
- **Non-interactive**: `wave -p "/goal npm test exits 0"`

## Status Display

When a goal is active, the status line shows:

```
◎ /goal active (3m) | Mode: default (Shift+Tab to cycle)
```

The elapsed time updates in real time.

## Clearing a Goal

Any of these aliases work:

```bash
/goal clear
/goal stop
/goal off
/goal reset
/goal none
/goal cancel
```

Running `/clear` also clears any active goal.

## Safety Limits

The autonomous loop has built-in circuit breakers:

| Limit | Value | What happens |
|-------|-------|--------------|
| Max turns | 50 | Goal is cancelled with "max turns exceeded" |
| Max duration | 30 minutes | Goal is cancelled with "time limit exceeded" |
| Eval failures | 3 consecutive | Goal is cancelled with error message |

## How It Works

1. You set a goal condition.
2. The agent works on it for one turn.
3. After the turn, the fast model evaluates the conversation against the goal condition (shows `✻ Evaluating goal...`).
4. If the goal is not met, the agent continues with a reminder of the reason and the goal.
5. If the goal is met, the loop stops and the agent returns to normal interactive mode.

## Restrictions

- Goals cannot be set in **plan mode**.
- Goal conditions are limited to **4000 characters**.
- Only one goal can be active at a time (setting a new goal replaces the old one).
