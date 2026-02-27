# Research: CLI Worktree Support

## Decision: CLI Argument Parsing
- **Choice**: Use `yargs` in `packages/code/src/index.ts`.
- **Rationale**: `yargs` is already used for parsing CLI arguments in the `code` package. Adding `-w` and `--worktree` as optional arguments is straightforward.
- **Alternatives**: Manual parsing of `process.argv`, but `yargs` provides better structure and help generation.

## Decision: Worktree Management
- **Choice**: Use `child_process.execSync` to run `git worktree` commands.
- **Rationale**: `git worktree` is a robust built-in git feature. Executing it via shell is simple and reliable since `git` is a required dependency.
- **Alternatives**: Using a Node.js git library like `isomorphic-git`, but it might not support all worktree features and adds unnecessary weight.

## Decision: Working Directory Management
- **Choice**: Change `process.cwd()` before initializing the React Ink application.
- **Rationale**: This ensures that the entire application, including the agent and all file-based tools, operates within the worktree directory without needing to modify every file path.
- **Alternatives**: Passing the worktree path as a variable throughout the app, but this would require extensive refactoring.

## Decision: Exit Handling and Interactive Prompt
- **Choice**: Implement a custom exit state in the main React component (`App.tsx`) and a new `WorktreeExitPrompt` component.
- **Rationale**: React Ink is used for the CLI UI. Handling the exit logic within the React tree allows for a consistent interactive experience using Ink's `useInput` hook.
- **Alternatives**: Using `process.on('exit')` with a synchronous prompt, but this would break the React Ink UI and is less user-friendly.

## Decision: Git Status Detection
- **Choice**: Use `git status --porcelain` for uncommitted changes and `git log @{u}..HEAD` for new commits.
- **Rationale**: These commands provide machine-readable and reliable information about the state of the repository.
- **Alternatives**: Parsing the output of `git status` (non-porcelain), but it's more complex and prone to changes in git versions.

## Decision: Auto-generated Name
- **Choice**: Use `generateRandomName` from `packages/agent-sdk/src/utils/nameGenerator.ts`.
- **Rationale**: This utility is already used for generating plan file names. Reusing it ensures consistency across the Wave CLI and avoids duplicating logic. The utility has been updated to generate names in a three-word `adjective-adjective-noun` format (e.g., `gentle-swift-breeze`) to provide more uniqueness and match the user's preference.
- **Alternatives**: Implementing a new naming scheme or using a third-party library like `unique-names-generator`, but the existing utility is sufficient and already integrated.
