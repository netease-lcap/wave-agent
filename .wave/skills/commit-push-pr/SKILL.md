---
name: commit-push-pr
description: Commit, push, and open a PR
context: fork
model: gemini-2.5-flash
allowed-tools:
  - Bash(git checkout --branch*)
  - Bash(git checkout -b*)
  - Bash(git add*)
  - Bash(git status*)
  - Bash(git push*)
  - Bash(git commit*)
  - Bash(gh pr create*)
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Commit messages diff with main: !`git log main..HEAD --oneline`

## Your task

Based on the above changes:

1. Create a new branch if on main
2. Create a single commit with an appropriate message
3. Push the branch to origin with upstream set (e.g., `git push -u origin <branch-name>`)
4. Create a pull request using `gh pr create`. The PR title and body MUST reflect all commits in the branch (refer to "Commit messages diff with main" in the context).
5. You have the capability to call multiple tools in a single response. You MUST do all of the above in a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.
