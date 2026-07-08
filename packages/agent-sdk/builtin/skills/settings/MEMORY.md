# Wave Memory

Wave provides multiple memory layers to give the agent context-specific instructions and knowledge. Memory files are standard Markdown files loaded automatically at startup.

## Memory Layers

Wave looks for memory in the following locations, loaded in order of increasing priority:

1. **User Memory**: `~/.wave/AGENTS.md` — Global instructions across all projects
2. **Project Memory**: `AGENTS.md` in the project root — Project-specific instructions
3. **Memory Rules**: `.wave/rules/*.md` and `~/.wave/rules/*.md` — Modular, path-scoped rules (see below)

> `CLAUDE.md` is also supported as a fallback for both user and project memory, for compatibility with existing repositories.

## User Memory

Stored at `~/.wave/AGENTS.md`. Use it for cross-project preferences and global instructions, e.g. "always write tests for new features", "prefer functional style".

## Project Memory

### Project Memory File

The `AGENTS.md` file in the project root is the primary project-level memory. It is checked into the repository and shared with all contributors. Use it for:

- Build and test commands (e.g. "use pnpm not npm")
- Project structure and architecture conventions
- Coding standards and patterns

### Memory Rules

Memory rules are modular Markdown files that provide path-scoped instructions. They are discovered in:

- **Project scope**: `.wave/rules/*.md` (checked into the repo)
- **User scope**: `~/.wave/rules/*.md` (personal, not shared)

Each file can optionally include YAML frontmatter to scope rules to specific file paths:

```markdown
---
paths:
  - "src/api/**/*.ts"
  - "src/services/**/*.ts"
---

# API and Service Guidelines

- Always use `async/await` for asynchronous operations.
- Use `Zod` for input validation.
```

#### YAML Frontmatter Fields

- `paths`: (Optional) A list of glob patterns. The rules in this file will only be active when the agent is working with files that match these patterns. If omitted, the rules are always active.
- `priority`: (Optional) A number controlling rule precedence. Higher priority rules override lower ones on conflict.

#### How Memory Rules are Loaded

- Wave recursively discovers all `.md` files in `.wave/rules/` and `~/.wave/rules/`.
- **Path-specific activation**: If a rule has a `paths` field, it is only included in the agent's context when a file being read or modified matches the glob patterns.
- **Unconditional rules**: Rules without a `paths` field are always active.
- **Priority**: Project-level rules take priority over user-level rules if there is a conflict.

#### Best Practices

- **Keep rules focused**: Create separate files for different topics (e.g. `testing.md`, `ui-components.md`).
- **Leverage path scoping**: Use the `paths` field to keep the agent's context window clean and relevant.
- **Share with your team**: Commit `.wave/rules/` to your git repository.

## Auto-Memory

In addition to manual memory files, Wave has an **auto-memory** feature that automatically extracts and remembers important information across sessions. This is stored in `~/.wave/projects/<project-id>/memory/MEMORY.md`.

You can control auto-memory in `settings.json`:

- `autoMemoryEnabled`: Enable or disable auto-memory (default: `true`).
- `autoMemoryFrequency`: Frequency of auto-memory extraction turns (default: `1`).
