# Quickstart: CLI Worktree Support

This feature allows you to start a Wave session in a dedicated git worktree, keeping your main working directory clean.

## Usage

### Start a Worktree Session with a Name
To start a session in a worktree with a specific name:
```bash
wave code --worktree my-feature
```
This will:
1. Identify the default remote branch.
2. Create a new git branch named `worktree-my-feature` from that branch.
3. Create a git worktree at `.wave/worktrees/my-feature`.
4. Start the Wave session in that worktree.

### Start a Worktree Session with an Auto-generated Name
To quickly start a session without thinking of a name:
```bash
wave code -w
```
This will generate a unique name (e.g., `gentle-swift-breeze`) and create the worktree at `.wave/worktrees/gentle-swift-breeze`.

## Exiting a Worktree Session

When you exit the Wave CLI (e.g., by pressing `Ctrl+C`), the system will check for any uncommitted changes or new commits in the worktree.

### If No Changes are Detected
The CLI will exit immediately, and the git worktree and its associated branch will be deleted automatically. This keeps your environment clean.

### If Changes are Detected
If you have uncommitted changes or new commits, you will see an interactive prompt:

```text
Exiting worktree session
 You have 1 uncommitted file. These will be lost if you remove the worktree.

 ❯ Keep worktree    Stays at /home/user/project/.wave/worktrees/gentle-swift-breeze
   Remove worktree  All changes and commits will be lost.

 Enter to confirm · Esc to cancel
```

- **Keep worktree**: The CLI exits, but the worktree directory and its associated branch are preserved. You can return to it later.
- **Remove worktree**: The git worktree and the associated branch are deleted. **All uncommitted changes and new commits will be lost.**

### Resuming a Worktree Session
To resume a session in an existing worktree, simply run the command again with the same name:
```bash
wave code --worktree my-feature
```
If the worktree already exists, Wave will use it.
