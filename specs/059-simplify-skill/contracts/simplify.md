# Simplify Skill Contracts

## Skill Frontmatter

```yaml
name: simplify
description: >
  Review the changed code for reuse, simplification, efficiency, and altitude cleanups,
  then apply the fixes. Quality only — it does not hunt for bugs; use /code-review for that.
disable-model-invocation: true
```

## Phase Contracts

### Phase 1: Identify Changes

- Run `git diff` (or `git diff HEAD` if there are staged changes).
- If no git changes exist, review the most recently modified files that the user mentioned or that the agent edited earlier in the conversation.

### Phase 2: Launch Three Review Agents in Parallel

All three agents launched concurrently in a single message via the Agent tool. Each receives the full diff.

| # | Agent | Dimension |
|---|-------|-----------|
| 1 | Code Reuse Review | reuse |
| 2 | Code Quality Review | quality |
| 3 | Efficiency Review | efficiency |

#### Agent 1: Code Reuse Review

1. Search for existing utilities/helpers that could replace newly written code.
2. Flag any new function that duplicates existing functionality.
3. Flag inline logic that could use an existing utility (string manipulation, path handling, env checks, type guards).

#### Agent 2: Code Quality Review

1. Redundant state
2. Parameter sprawl
3. Copy-paste with slight variation
4. Leaky abstractions
5. Stringly-typed code
6. Unnecessary JSX nesting
7. Unnecessary comments (keep only non-obvious WHY)

#### Agent 3: Efficiency Review

1. Unnecessary work (redundant computations, repeated reads, N+1)
2. Missed concurrency
3. Hot-path bloat
4. Recurring no-op updates (including same-reference-return violations)
5. Unnecessary existence checks (TOCTOU)
6. Memory (unbounded structures, missing cleanup, listener leaks)
7. Overly broad operations

### Phase 3: Fix Issues

1. Wait for all three agents to complete.
2. Aggregate findings.
3. Fix each issue directly.
4. If a finding is a false positive or not worth addressing, note it and skip — do not argue.
5. Summarize what was fixed (or confirm the code was already clean).

## False-Positive Handling

- False positives are noted and skipped, not argued with.
- No confidence scoring (unlike `/code-review`); the main agent uses judgment to skip.
