# Quickstart: Split Chained Bash Commands

This feature improves how the Wave Agent handles permissions for chained bash commands (e.g., `cmd1 && cmd2`).

## How it Works

When you execute a chained bash command and select **"Don't ask again"**, the system now:

1.  **Splits** the command into individual simple commands (e.g., `mkdir test` and `cd test`).
2.  **Filters** out "safe" commands (like `cd`, `ls`, `pwd`) that don't require explicit permission.
3.  **Saves** only the non-safe commands to your allowed list.

### Example

If you run:
```bash
mkdir my-project && cd my-project && npm init -y
```

And select "Don't ask again", your `settings.local.json` will be updated with:
- `Bash(mkdir my-project)`
- `Bash(npm init -y)`

The `cd my-project` command is automatically allowed and not saved to the list.

## Benefits

-   **Granular Permissions**: Allowing `mkdir my-project && cd my-project` now also allows `mkdir my-project` on its own.
-   **Cleaner Configuration**: Your allowed list won't be cluttered with safe commands like `cd` or `ls`.
-   **Better Matching**: Chained commands are now correctly recognized and auto-allowed in future executions.

## Testing the Feature

1.  Run a chained command: `mkdir test_dir && cd test_dir`.
2.  When prompted, select **"Don't ask again"**.
3.  Check your `settings.local.json` (usually in `~/.wave/settings.local.json` or the project root).
4.  Verify that `Bash(mkdir test_dir)` is present, but `Bash(cd test_dir)` is not.
5.  Run `mkdir test_dir` again; it should be allowed automatically.
