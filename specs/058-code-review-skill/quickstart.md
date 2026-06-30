# Quickstart: Code Review Skill

## Overview

`/code-review` reviews the current branch's diff for correctness bugs and quality issues. It works with any git host (GitHub, GitLab, self-hosted) — no `gh` CLI required.

## Basic Usage

```bash
# Default review (medium effort: 3 agents, confidence threshold 80)
/code-review

# Quick review (2 agents, only near-certain findings)
/code-review low

# Thorough review (4 agents, broader coverage)
/code-review high

# Maximum review (5 agents, includes efficiency check)
/code-review max
```

## How It Works

1. **Gather context** — runs `git diff` against `main` (falls back to `HEAD~1`).
2. **Launch review agents** — parallel subagents scan different dimensions (bugs, AGENTS.md compliance, git history, code reuse, efficiency) depending on effort level.
3. **Score findings** — each finding gets an independent 0–100 confidence score from a separate agent.
4. **Filter & deliver** — findings below the effort's threshold are dropped. If no issues remain, says "no issues" and stops. Otherwise:
   - **Post as comment** (preferred): if `gh`/`glab` is installed and a PR/MR exists, the review is posted as a PR/MR comment.
   - **Output directly** (fallback): if no CLI, no PR/MR, or posting fails, findings are output to the terminal.

## Effort Levels

| Effort | Agents | Threshold | Best For |
|--------|--------|-----------|----------|
| `low` | 2 | 90 | Small changes, quick sanity check |
| `medium` (default) | 3 | 80 | Everyday review |
| `high` | 4 | 70 | Larger changes, moderate risk |
| `max` | 5 | 60 | Big refactors, high-risk changes |

## Report Format

Findings are reported as a numbered list:

```
## Code Review

Found 2 issues:

1. <brief description> (AGENTS.md says "<rule>")

   `src/foo.ts:42-58`

2. <brief description> (bug due to <file and snippet>)

   `src/bar.ts:10-15`
```

If no issues pass the threshold, the skill says so and stops — nothing is posted or output.

## Delivery: Comment vs Terminal

Findings are delivered via one of two paths:

- **Post as comment** (preferred): if `gh` is installed and a GitHub PR exists → `gh pr comment`; if `glab` is installed and a GitLab MR exists → `glab mr note`. Findings are NOT output to the terminal.
- **Output directly** (fallback): if no CLI is installed, no PR/MR exists, the platform is unrecognized, or posting fails → findings are output to the terminal.

Platform detection is based on the remote URL (`git remote get-url origin`).

## Notes

- The skill does **not** auto-fix issues — it reports only. Use `/simplify` to apply quality fixes.
- The skill does **not** build or typecheck — run those separately.
- The skill is **not** auto-triggered by the AI; it must be invoked explicitly via `/code-review`.
