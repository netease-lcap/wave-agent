# Quickstart: Creating a Local Plugin

Follow these steps to create and test your first Wave plugin.

## 1. Create the plugin directory
```bash
mkdir my-first-plugin
```

## 2. Create the plugin manifest
Create `.wave-plugin/plugin.json` inside your plugin folder:
```bash
mkdir my-first-plugin/.wave-plugin
```

`my-first-plugin/.wave-plugin/plugin.json`:
```json
{
  "name": "my-first-plugin",
  "description": "A greeting plugin to learn the basics",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

## 3. Add a slash command
Create a `commands` directory and a `hello.md` file:
```bash
mkdir my-first-plugin/commands
```

`my-first-plugin/commands/hello.md`:
```markdown
---
description: Greet the user with a friendly message
---

# Hello Command

Greet the user warmly and ask how you can help them today.
```

## 4. Test your plugin
Run Wave with the `--plugin-dir` flag:
```bash
wave --plugin-dir ./my-first-plugin
```

Once Wave starts, try your new command:
```
/my-first-plugin:hello
```
