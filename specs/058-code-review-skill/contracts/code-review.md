# Code Review Skill Contracts

## Skill Frontmatter

```yaml
name: code-review
description: >
  Review the current diff for correctness bugs and reuse/simplification/efficiency
  cleanups at the given effort level (low/medium: fewer, high-confidence findings;
  high/max: broader coverage, may include lower-confidence findings)
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git show:*), Bash(git blame:*), Bash(git remote:*), Bash(command -v:*), Bash(gh pr comment:*), Bash(gh pr view:*), Bash(glab mr note:*), Bash(glab mr view:*), Read, Glob, Grep, Agent
disable-model-invocation: true
```

## Phase Contracts

### Phase 1: Gather Context

Executes four bash commands via skill substitution:
- `git status`
- `git diff --name-only <merge-base>...HEAD` (fallback: `HEAD~1...HEAD`)
- `git log --no-decorate <merge-base>...HEAD` (fallback: `HEAD~1...HEAD`)
- `git diff <merge-base>...HEAD` (fallback: `HEAD~1...HEAD`)

Stops early if no changes exist.

### Phase 2: Determine Effort Level

Parses `$ARGUMENTS`:
- `low` → 2 agents, threshold 90
- `medium` (default/empty) → 3 agents, threshold 80
- `high` → 4 agents, threshold 70
- `max` → 5 agents, threshold 60

### Phase 3: Launch Review Agents

All agents launched concurrently in a single message via the Agent tool. Each receives the full diff.

| # | Agent | Effort Levels |
|---|-------|---------------|
| 1 | Bug Scanner | all |
| 2 | AGENTS.md Compliance | all |
| 3 | Git History Context | medium+ |
| 4 | Code Reuse & Quality | high+ |
| 5 | Efficiency Review | max only |

### Phase 4: Confidence Scoring

For each finding from Phase 3, launch a parallel Agent that independently scores 0–100 using the fixed rubric (see [data-model.md](../data-model.md)). The scoring agent receives: the PR diff, the issue description, and the list of AGENTS.md files.

### Phase 5: Filter and Deliver

1. Drop findings with score < threshold.
2. If none remain, say "no issues" and stop — do not post or output anything.
3. Detect platform and CLI availability via skill bash substitution:
   - `git remote get-url origin` — remote URL
   - `command -v gh` — GitHub CLI availability
   - `command -v glab` — GitLab CLI availability
4. **Post as comment** (preferred): If GitHub + `gh` + PR exists → `gh pr comment --body "<review>"`. If GitLab + `glab` + MR exists → `glab mr note --message "<review>"`. Do NOT output to terminal.
5. **Output directly** (fallback): If no CLI, no PR/MR, unrecognized platform, or posting failed → output findings to terminal.

**Constraints**: Same format for both comment and direct output. Brief, no emojis.

## Report Format Contract

```
## Code Review

Found N issues:

1. <description> (AGENTS.md says "<quote>")

   `<file>:<line range>`

2. <description> (bug due to <file and code snippet>)

   `<file>:<line range>`
```

## False-Positive Exclusion Contract

The following categories MUST be excluded:
- Pre-existing issues not introduced in this diff
- Non-bug-looking patterns
- Pedantic nitpicks
- Linter/typechecker/compiler-level issues
- General quality gaps (unless AGENTS.md requires)
- Issues silenced in code (e.g., lint-ignore comments)
- Intentional/directly-related changes
- Real issues on unmodified lines
