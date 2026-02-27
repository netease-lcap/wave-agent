# Data Model: CLI Worktree Support

## Entities

### WorktreeSession
Represents a git worktree session created by the CLI.

- **name**: `string`
  - The unique identifier for the worktree and its associated branch.
  - Example: `gentle-swift-breeze`
- **path**: `string`
  - The absolute filesystem path where the worktree is located.
  - Example: `/home/user/project/.wave/worktrees/gentle-swift-breeze`
- **branch**: `string`
  - The name of the git branch created for this worktree.
  - Example: `worktree-gentle-swift-breeze`
- **hasUncommittedChanges**: `boolean`
  - `true` if there are staged or unstaged changes in the worktree.
- **hasNewCommits**: `boolean`
  - `true` if there are commits in the worktree branch that are not in the base branch.

## State Transitions

1. **Initialization**:
   - CLI starts with `-w` or `--worktree`.
   - System generates a name if not provided.
   - System identifies the default remote branch.
   - System creates a new branch named `worktree-<name>` from the default remote branch.
   - System creates a git worktree at `.wave/worktrees/<name>`.
   - `WorktreeSession` is initialized with `name`, `path`, and `branch`.

2. **Execution**:
   - Agent operates within the worktree directory.
   - User makes changes and/or commits.

3. **Exit Detection**:
   - CLI exit is triggered.
   - System checks `git status --porcelain` to set `hasUncommittedChanges`.
   - System checks `git log @{u}..HEAD` to set `hasNewCommits`.

4. **User Decision**:
   - If `hasUncommittedChanges` or `hasNewCommits` is `true`, show prompt.
     - **Keep worktree**: Exit CLI, leave worktree and branch intact.
     - **Remove worktree**: Run `git worktree remove --force <path>` and `git branch -D <branch>`, then exit.
   - If both are `false`, automatically run `git worktree remove --force <path>` and `git branch -D <branch>`, then exit.
