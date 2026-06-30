# Data Model: Simplify Skill

## Review Agents

| Agent | Dimension | Focus |
|-------|-----------|-------|
| Code Reuse Review | Reuse | Search for existing utilities/helpers; flag duplicates; flag inline logic replaceable by existing utilities (string manipulation, path handling, env checks, type guards) |
| Code Quality Review | Quality | Redundant state, parameter sprawl, copy-paste with variation, leaky abstractions, stringly-typed code, unnecessary JSX nesting, unnecessary comments (keep only non-obvious WHY) |
| Efficiency Review | Efficiency | Unnecessary work, missed concurrency, hot-path bloat, recurring no-op updates (incl. same-reference-return violations), unnecessary existence checks (TOCTOU), memory issues, overly broad operations |

## Code Quality Checklist

| Pattern | Description |
|---------|-------------|
| Redundant state | State duplicating existing state; cached values that could be derived; observers/effects that could be direct calls |
| Parameter sprawl | Adding parameters instead of generalizing or restructuring |
| Copy-paste with variation | Near-duplicate blocks that should be unified |
| Leaky abstractions | Exposing internal details that should be encapsulated |
| Stringly-typed code | Raw strings where constants/enums/branded types exist |
| Unnecessary JSX nesting | Wrapper Boxes/elements adding no layout value |
| Unnecessary comments | Comments explaining WHAT (delete); keep only non-obvious WHY |

## Efficiency Checklist

| Pattern | Description |
|---------|-------------|
| Unnecessary work | Redundant computations, repeated file reads, duplicate API calls, N+1 patterns |
| Missed concurrency | Sequential operations that could be parallel |
| Hot-path bloat | Blocking work in startup or per-request/per-render paths |
| Recurring no-op updates | State/store updates in loops/intervals/handlers firing unconditionally; updater callbacks not honoring same-reference returns |
| Unnecessary existence checks | Pre-checking file/resource existence before operating (TOCTOU) — operate directly and handle errors |
| Memory | Unbounded data structures, missing cleanup, event listener leaks |
| Overly broad operations | Reading entire files when a portion suffices; loading all items when filtering for one |

## Finding

| Field | Type | Description |
|-------|------|-------------|
| `dimension` | `'reuse' \| 'quality' \| 'efficiency'` | Which agent found it |
| `description` | `string` | Description of the quality issue |
| `suggestion` | `string?` | Suggested fix or existing utility to use |

## Relationships
- A **ReviewAgent** produces zero or more **Finding**s.
- Each **Finding** is resolved by a **Fix** applied in Phase 3.
- False-positive **Finding**s are skipped (noted, not fixed).
