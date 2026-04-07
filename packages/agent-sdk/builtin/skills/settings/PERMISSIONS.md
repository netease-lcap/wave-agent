# Tool Permissions & Safe Zone

Wave includes a robust permission system to protect your system while allowing the AI to be productive. This system is centered around the "Safe Zone" and configurable permission modes.

## The Safe Zone

The Safe Zone is a set of directories where Wave is allowed to perform potentially sensitive operations (like editing or writing files) with reduced friction.

By default, the Safe Zone includes:
- The current project directory.
- The Wave configuration directories (`~/.wave/` and `.wave/`).
- The system temporary directory.

You can extend the Safe Zone by adding `additionalDirectories` to your `permissions` configuration in `settings.json`.

## Permission Modes

The `permissionMode` setting determines how Wave handles requests to use restricted tools (e.g., `Bash`, `Edit`, `Write`, `AskUserQuestion`).

| Mode | Description |
| :--- | :--- |
| `default` | **Recommended.** Wave will ask for your permission before using any restricted tool. |
| `bypassPermissions` | **Use with caution.** Wave will execute all tools without asking for permission. |
| `acceptEdits` | Wave will automatically allow `Edit` and `Write` operations within the Safe Zone. It will still ask for permission for `Bash` and operations outside the Safe Zone. |
| `plan` | Restricted mode for editing the plan file (usually internal). |
| `dontAsk` | Wave will automatically deny all restricted tools without asking. This is the most restrictive mode. |

### Example Configuration

```json
{
  "permissions": {
    "permissionMode": "default",
    "additionalDirectories": ["/home/user/my-exports"],
    "allow": ["ls -R", "git status"],
    "deny": ["rm -rf"]
  }
}
```

## Allow and Deny Rules

You can pre-approve or explicitly forbid specific operations using `allow` and `deny` rules.

- **`allow`**: An array of string patterns (e.g., bash commands or file paths) that are always permitted.
- **`deny`**: An array of string patterns that are always forbidden.

When a tool is called, Wave checks:
1. If the operation matches a `deny` rule, it is rejected.
2. If the operation matches an `allow` rule, it is permitted.
3. If no rules match, the behavior depends on the `permissionMode`.

## Managing Permissions via CLI

You can also manage permissions directly through the Wave interface:
- When Wave asks for permission, you can select "Always allow" to add a rule to your `settings.local.json`.
- You can ask Wave to "Update my permission mode to acceptEdits".
