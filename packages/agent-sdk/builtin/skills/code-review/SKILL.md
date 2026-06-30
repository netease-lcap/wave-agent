---
name: code-review
description: Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups at the given effort level (low/medium: fewer, high-confidence findings; high/max: broader coverage, may include lower-confidence findings)
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git show:*), Bash(git blame:*), Bash(git remote:*), Bash(command -v:*), Bash(gh pr comment:*), Bash(gh pr view:*), Bash(glab mr note:*), Bash(glab mr view:*), Read, Glob, Grep, Agent
disable-model-invocation: true
---

# Code Review

Review the current branch's changes for correctness bugs and quality issues.

## Phase 1: Gather Context

First, collect the diff and metadata:

```
GIT STATUS:
!`git status`

FILES MODIFIED:
!`git diff --name-only $(git merge-base HEAD main)...HEAD 2>/dev/null || git diff --name-only HEAD~1...HEAD`

COMMITS:
!`git log --no-decorate $(git merge-base HEAD main 2>/dev/null || echo HEAD~1)...HEAD`

DIFF CONTENT:
!`git diff $(git merge-base HEAD main 2>/dev/null || echo HEAD~1)...HEAD`
```

If there are no changes, stop and tell the user.

## Phase 2: Determine Effort Level

Parse `$ARGUMENTS` for an effort level:
- **low**: Launch 2 agents, confidence threshold 90 (only near-certain findings)
- **medium** (default): Launch 3 agents, confidence threshold 80
- **high**: Launch 4 agents, confidence threshold 70
- **max**: Launch 5 agents, confidence threshold 60 (broader coverage, more noise)

## Phase 3: Launch Review Agents in Parallel

Use the Agent tool to launch all agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

### Agent 1: Bug Scanner (all effort levels)

Read the file changes in the diff, then do a shallow scan for obvious bugs. Avoid reading extra context beyond the changes, focusing just on the changes themselves. Focus on large bugs, and avoid small issues and nitpicks. Ignore likely false positives.

### Agent 2: AGENTS.md Compliance (all effort levels)

Audit the changes to make sure they comply with any AGENTS.md files in the repository. Check the root AGENTS.md (if it exists) and any AGENTS.md files in the directories whose files were modified. Note that AGENTS.md is guidance for AI agents as they write code, so not all instructions will be applicable during code review.

### Agent 3: Git History Context (medium and above)

Read the git blame and history of the code modified, to identify any bugs in light of that historical context.

### Agent 4: Code Reuse & Quality (high and above)

Search for existing utilities and helpers that could replace newly written code. Also review for hacky patterns: redundant state, parameter sprawl, copy-paste with slight variation, leaky abstractions, stringly-typed code, and unnecessary comments.

### Agent 5: Efficiency Review (max only)

Review the changes for efficiency: unnecessary work, missed concurrency, hot-path bloat, recurring no-op updates, unnecessary existence checks, memory leaks, and overly broad operations.

## Phase 4: Confidence Scoring

For each issue found in Phase 3, launch a parallel Agent to independently score the issue. The scoring agent receives the PR diff, the issue description, and the list of AGENTS.md files (if any). It returns a confidence score from 0-100.

Give the scoring agent this rubric verbatim:

- **0**: Not confident at all. This is a false positive that doesn't stand up to light scrutiny, or is a pre-existing issue.
- **25**: Somewhat confident. This might be a real issue, but may also be a false positive. The agent wasn't able to verify that it's a real issue. If the issue is stylistic, it is one that was not explicitly called out in the relevant AGENTS.md.
- **50**: Moderately confident. The agent was able to verify this is a real issue, but it might be a nitpick or not happen very often in practice. Relative to the rest of the PR, it's not very important.
- **75**: Highly confident. The agent double checked the issue, and verified that it is very likely it is a real issue that will be hit in practice. The existing approach in the PR is insufficient. The issue is very important and will directly impact the code's functionality, or it is an issue that is directly mentioned in the relevant AGENTS.md.
- **100**: Absolutely certain. The agent double checked the issue, and confirmed that it is definitely a real issue, that will happen frequently in practice. The evidence directly confirms this.

## Phase 5: Filter and Deliver

1. Filter out any issues with a score below the effort level's threshold.
2. If no issues remain, say so and stop — do not post anything.
3. Otherwise, detect the platform and CLI availability:

```
REMOTE URL:
!`git remote get-url origin 2>/dev/null || echo "no-remote"`

GH CLI:
!`command -v gh 2>/dev/null || echo "not-installed"`

GLAB CLI:
!`command -v glab 2>/dev/null || echo "not-installed"`
```

4. **Post as comment** (preferred): If the remote URL contains `github` and `gh` is installed, check if a PR exists for the current branch (`gh pr view --json number`), then post the review as a comment: `gh pr comment --body "<review content>"`. If the remote URL contains `gitlab` and `glab` is installed, check if an MR exists for the current branch (`glab mr view`), then post the review as a note: `glab mr note --message "<review content>"`.
5. **Output directly** (fallback): If no CLI is installed, no PR/MR exists, or the platform is unrecognized, output the findings directly instead.

Whether posting or outputting, use this format:

---

## Code Review

Found N issues:

1. <brief description of bug> (AGENTS.md says "<...>")

   `<file>:<line range>`

2. <brief description of bug> (bug due to <file and code snippet>)

   `<file>:<line range>`

---

Keep the comment brief and avoid emojis.

## False Positive Filtering

Examples of false positives to exclude:

- Pre-existing issues not introduced in this diff
- Something that looks like a bug but is not actually a bug
- Pedantic nitpicks that a senior engineer wouldn't call out
- Issues that a linter, typechecker, or compiler would catch (eg. missing or incorrect imports, type errors, broken tests, formatting issues)
- General code quality issues (eg. lack of test coverage, general security issues, poor documentation), unless explicitly required in AGENTS.md
- Issues that are called out in AGENTS.md, but explicitly silenced in the code (eg. due to a lint ignore comment)
- Changes in functionality that are likely intentional or are directly related to the broader change
- Real issues, but on lines that the user did not modify in their changes

## Notes

- Do not check build signal or attempt to build or typecheck the app. These will run separately.
- You must cite the file and line range for each finding.
- Make a todo list first.

## Input

$ARGUMENTS
