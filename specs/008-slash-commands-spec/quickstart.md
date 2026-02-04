# Custom Slash Commands - Quick Start Guide

**Feature**: Custom Slash Commands  
**Generated**: December 19, 2024

## What are Slash Commands?

Slash commands let you create reusable AI workflow templates by placing simple markdown files in `.wave/commands/` directories. Think of them as custom shortcuts for common tasks.

## Getting Started

### 1. Create Your First Command

Create a file at `.wave/commands/hello.md`:

```markdown
---
description: A friendly greeting command
---

Hello! Please help me with $ARGUMENTS
```

Now you can use `/hello write a function` and the AI will receive "Hello! Please help me write a function"

### 2. Using Arguments

Commands support two types of arguments:

**Full Arguments** - `$ARGUMENTS` includes everything after the command:
```markdown
---
description: Review code files
---

Please review the following files: $ARGUMENTS
```

Usage: `/review src/app.ts src/utils.ts`

**Positional Arguments** - `$1`, `$2`, etc. for specific parameters:
```markdown
---
description: Compare two files
---

Compare $1 with $2 and show the differences.
```

Usage: `/compare old.txt new.txt`

### 3. Running Commands Before AI

Use `!`backticks` to run bash commands first:

```markdown
---
description: Show project structure
---

Here's the current project structure:

!`ls -la`

Please help me organize these files.
```

The command output will be included in the prompt sent to the AI.

### 4. Customizing AI Behavior

Use frontmatter to configure how commands run:

```markdown
---
description: Code review with GPT-4
model: gpt-4
---

Please review this code for best practices.
```

### 5. Plugin Commands with File Access

Plugin commands can access their own files using `$WAVE_PLUGIN_ROOT`:

```markdown
---
description: Load plugin template
---

Use this template:

!`cat $WAVE_PLUGIN_ROOT/templates/default.txt`
```

**Note**: Use `$WAVE_PLUGIN_ROOT` (with `$` escaped as `$$` in the markdown file) to reference the plugin directory.

### 6. Auto-Approving Tools

Allow specific tools to run without asking permission:

```markdown
---
description: Auto-check git status
allowed-tools:
  - Bash(git status)
  - Bash(git diff:*)
---

Check git status and show what changed.
```

The AI can now run `git status` and `git diff` automatically. Wildcards like `git:*` work too.

## Command Locations

- **Project commands**: `.wave/commands/` in your project
- **User commands**: `~/.wave/commands/` for all projects
- **Priority**: Project commands override user commands with the same name

## Tips

1. **Keep it simple**: Commands are just templates - let the AI do the complex work
2. **Use descriptive names**: `/review-code` is better than `/rc`
3. **Test with echo**: Try `!`echo $WAVE_PLUGIN_ROOT`` to verify environment variables
4. **Start small**: Begin with simple text templates before adding bash commands

## Examples

**Quick review command:**
```markdown
---
description: Quick code review
---

Review this code for:
- Bugs and edge cases
- Performance issues
- Best practices

Code: $ARGUMENTS
```

**Project setup:**
```markdown
---
description: Show project info
---

Project information:

!`cat package.json`

Please explain what this project does.
```

**Template generator:**
```markdown
---
description: Create component template
---

Create a React component named $1 with:
- TypeScript types
- Props interface
- Basic styling
```

Usage: `/create-component Button`

That's it! Start creating commands that save you time.
