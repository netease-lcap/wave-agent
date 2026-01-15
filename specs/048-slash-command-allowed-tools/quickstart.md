# Quickstart: Slash Command Allowed Tools

## Overview
This feature allows slash commands to define a set of "allowed tools" that the AI can execute without manual user confirmation. These permissions are temporary and scoped to the execution of the slash command.

## How to use

### 1. Define a Slash Command with Allowed Tools
Create a markdown file in `.wave/commands/my-command.md`:

```markdown
---
description: A command that checks git status automatically
allowed-tools:
  - Bash(git status)
  - Bash(git diff:*)
---

Check the git status and diff for me.
```

### 2. Trigger the Command
In the Wave Agent chat, type:
```text
/my-command
```

### 3. Automatic Execution
The AI will now be able to run `git status` and `git diff` without prompting you for permission. Other restricted tools (like `Write` or `Delete`) will still require confirmation unless they are also listed in `allowed-tools` or your `settings.json`.

## Security Note
- Permissions are **temporary**. They are revoked as soon as the AI finishes its response cycle for the slash command.
- Permissions are **scoped**. They only apply to the tools and patterns you explicitly list.
- Wildcards are supported (e.g., `Bash(git:*)`).
