# Quickstart: Memory Management

## Overview
This feature adds a Memory Management system triggered by `#` to persist information across conversations.

## Development Setup
1. Build the `agent-sdk` to include the memory service:
   ```bash
   pnpm -F agent-sdk build
   ```
2. Run the CLI to test memory saving:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for the memory service and selector component:
```bash
pnpm -F agent-sdk test tests/services/memory.test.ts
pnpm -F code test tests/components/MemoryTypeSelector.test.tsx
```

### Manual Verification
1. Start the agent.
2. Type `# Use pnpm instead of npm` and press `Enter`.
3. Select "Project" memory in the UI.
4. Verify `AGENTS.md` is created/updated in the current directory.
5. Ask the agent "What package manager should I use?" and verify it mentions pnpm.

---

## Quickstart: Modular Rules

### Setting up Project Rules

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

### Setting up User Rules

1. Create a `~/.wave/rules/` directory.
2. Add your personal preferences, e.g., `~/.wave/rules/workflow.md`:

```markdown
# My Workflow

- Always run `pnpm lint` before finishing a task.
- Prefer using `Bash` tool for git operations.
```

### How it Works

- **Automatic Loading**: Wave automatically loads all `.md` files from these directories.
- **Path Scoping**: Rules with a `paths` field only apply when you are working on matching files.
- **Priority**: Project-level rules override user-level rules if there are conflicts.
- **Discovery**: Wave looks in `.wave/rules/` and its immediate subdirectories.
