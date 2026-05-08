# Wave Memory Rules Configuration

Memory rules allow you to provide context-specific instructions and guidelines to the agent. This document explains how to create and manage memory rules in Wave.

## What are Memory Rules?

Memory rules are Markdown files that contain instructions for the agent. They are used to:
- Enforce coding styles and conventions.
- Provide project-specific context (e.g., "always use pnpm").
- Define architectural patterns and best practices.
- Share common knowledge across the team.

## Creating Memory Rules

Wave looks for memory rules in the following locations:

1.  **User Scope**: `~/.wave/rules/*.md` (Global memory rules)
2.  **Project Scope**: `.wave/rules/*.md` (Project-specific memory rules)
3.  **Project Root**: `AGENTS.md` (Legacy project-level memory rules)

### File Structure

A memory rule file is a standard Markdown file. It can optionally include YAML frontmatter to scope the rules to specific file paths.

```markdown
---
paths:
  - "src/api/**/*.ts"
  - "src/services/**/*.ts"
---

# API and Service Guidelines

- Always use `async/await` for asynchronous operations.
- Use `Zod` for input validation.
- Follow the repository pattern for data access.
```

### YAML Frontmatter Fields

- `paths`: (Optional) A list of glob patterns. The rules in this file will only be active when the agent is working with files that match these patterns. If omitted, the rules are always active.

## How Memory Rules are Loaded

Wave automatically discovers and loads all `.md` files in the `.wave/rules/` directory and its immediate subdirectories.

- **Path-Specific Activation**: If a memory rule has a `paths` field, it is only included in the agent's context if *any* file currently being read or modified matches the glob patterns.
- **Union of Rules**: If multiple files are in context, Wave activates the union of all matching memory rules.
- **Priority**: Project-level memory rules take priority over user-level memory rules if there is a conflict.

## Best Practices

- **Keep rules focused**: Create separate files for different topics (e.g., `testing.md`, `ui-components.md`).
- **Use clear instructions**: Write rules in a way that is easy for the agent to understand and follow.
- **Leverage path scoping**: Use the `paths` field to keep the agent's context window clean and relevant.
- **Share rules with your team**: Commit `.wave/rules/` to your git repository to ensure everyone on the team has the same context.

## Auto-Memory

In addition to manual memory rules, Wave also has an **auto-memory** feature that automatically remembers important information across sessions. This is stored in `~/.wave/projects/<project-id>/memory/MEMORY.md`. You can disable this feature in `settings.json` by setting `"autoMemoryEnabled": false`.
