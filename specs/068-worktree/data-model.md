# Data Model: CLI Worktree Support

## Entities

### WorktreeSession (CLI-level)
Represents a git worktree session created by the CLI `-w` flag.

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
- **isNew**: `boolean`
  - `true` if the worktree was newly created in the current session.
  - `false` if an existing worktree was reused.

### WorktreeSession (SDK-level, mid-session)
Represents a worktree session created via `EnterWorktree` tool during an active agent session.

- **originalCwd**: `string`
  - The working directory the session was in before `EnterWorktree` was invoked.
- **worktreePath**: `string`
  - Path to the worktree directory.
- **worktreeBranch**: `string`
  - Git branch name for the worktree.
- **worktreeName**: `string`
  - User-provided or auto-generated worktree name.
- **isNew**: `boolean`
  - Whether this worktree was newly created.
- **repoRoot**: `string`
  - The canonical git repo root.
- **originalHeadCommit**?: `string`
  - The HEAD commit of the original branch at worktree creation time (for dirty-check on exit).

## State Transitions

### CLI Worktree Flow

1. **Initialization**:
   - CLI starts with `-w` or `--worktree`.
   - System generates a name if not provided.
   - System identifies the default remote branch.
   - System creates a new branch named `worktree-<name>` from the default remote branch.
   - System creates a git worktree at `.wave/worktrees/<name>`.
   - `WorktreeSession` is initialized with `name`, `path`, and `branch`.

2. **Execution**:
   - If `isNew` is `true`, trigger `WorktreeCreate` hook event.
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

### Mid-Session Tool Flow

1. **EnterWorktree**:
   - AI invokes `EnterWorktree` tool during an active session.
   - System validates not already in a worktree session (module-level check).
   - System resolves canonical git root from current workdir.
   - System creates worktree at `.wave/worktrees/<name>` with branch `worktree-<name>`.
   - System updates `AIManager.setWorkdir()` to change CWD (updates DI container + `process.chdir()`).
   - System stores session state in module-level `currentWorktreeSession`.

2. **ExitWorktree**:
   - AI invokes `ExitWorktree` tool with `action: "keep"` or `action: "remove"`.
   - System validates active worktree session exists.
   - If `action: "remove"` and dirty: system refuses unless `discard_changes: true`.
   - If `action: "remove"`: system deletes worktree and branch.
   - System restores CWD via `AIManager.setWorkdir(originalCwd)`.
   - System clears `currentWorktreeSession`.
