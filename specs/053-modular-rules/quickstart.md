# Quickstart: Modular Rules

## Setting up Project Rules

1. Create a `.wave/rules/` directory in your project root.
2. Add a Markdown file, e.g., `.wave/rules/api-style.md`:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Style Guide

- Use PascalCase for controller classes.
- All public methods must have JSDoc comments.
```

## Setting up User Rules

1. Create a `~/.wave/rules/` directory.
2. Add your personal preferences, e.g., `~/.wave/rules/workflow.md`:

```markdown
# My Workflow

- Always run `pnpm lint` before finishing a task.
- Prefer using `Bash` tool for git operations.
```

## How it Works

- **Automatic Loading**: Wave automatically loads all `.md` files from these directories.
- **Path Scoping**: Rules with a `paths` field only apply when you are working on matching files.
- **Priority**: Project-level rules override user-level rules if there are conflicts.
- **Discovery**: Wave looks in `.wave/rules/` and its immediate subdirectories.
