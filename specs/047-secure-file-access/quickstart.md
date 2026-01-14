# Quickstart: Secure File Access

This feature ensures that the agent only modifies files in designated "Safe Zones" without explicit confirmation.

## Configuration

Add allowed directories to your `.wave/settings.json` or `~/.wave/settings.json`:

```json
{
  "permissions": {
    "additionalDirectories": [
      "/path/to/my/other/project",
      "../shared-libs"
    ]
  }
}
```

## How it works

1.  **Safe Zone**: The agent considers the current working directory and any paths in `additionalDirectories` as safe.
2.  **Auto-Accept**: If `acceptEdits` mode is enabled, file operations (Write, Edit, MultiEdit, Delete) within the Safe Zone proceed automatically.
3.  **Security**: Any file operation **outside** the Safe Zone will **always** trigger a confirmation prompt, even if `acceptEdits` is enabled.
4.  **Symlinks**: The system resolves symbolic links to their real paths before checking against the Safe Zone.

## Testing

1.  Enable `acceptEdits` mode.
2.  Try to edit a file in the current directory -> Should succeed without prompt.
3.  Try to edit a file in an `additionalDirectory` -> Should succeed without prompt.
4.  Try to edit a file outside these directories (e.g., `/tmp/test.txt`) -> Should show a confirmation prompt.
