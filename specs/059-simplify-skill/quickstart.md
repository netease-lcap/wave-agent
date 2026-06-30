# Quickstart: Simplify Skill

## Overview

`/simplify` reviews your changed code for reuse, quality, and efficiency issues, then applies fixes directly. Quality only — it does not hunt for bugs; use `/code-review` for that.

## Basic Usage

```bash
# Review and fix quality issues in current changes
/simplify
```

## How It Works

1. **Identify changes** — runs `git diff` (or `git diff HEAD` if staged). Falls back to recently-modified files if no git changes.
2. **Launch three review agents** — parallel subagents review reuse, quality, and efficiency.
3. **Fix issues** — aggregates findings and fixes each issue directly. False positives are skipped.

## Review Dimensions

| Agent | What It Checks |
|-------|---------------|
| Code Reuse | Duplicated logic, existing utilities that could replace new code, inline logic (string/path/env/type-guard) |
| Code Quality | Redundant state, parameter sprawl, copy-paste, leaky abstractions, stringly-typed code, unnecessary JSX/comments |
| Efficiency | Unnecessary work, missed concurrency, hot-path bloat, no-op updates, TOCTOU checks, memory leaks, broad operations |

## When to Use Which

| Skill | Reports | Auto-Fixes | Focus |
|-------|---------|------------|-------|
| `/code-review` | Yes | No | Correctness bugs + quality |
| `/simplify` | No | Yes | Quality only (reuse/efficiency) |

Typical workflow: run `/code-review` to find bugs, fix them, then run `/simplify` to clean up quality.

## Notes

- The skill is **not** auto-triggered by the AI; it must be invoked explicitly via `/simplify`.
- False positives are skipped — the skill notes them and moves on without arguing.
- After fixing, the skill summarizes what was fixed (or confirms the code was already clean).
