# Creating and Managing Wave Skills

Skills are discoverable capabilities that extend Wave's functionality. They allow you to package instructions, tools, and scripts into reusable modules.

## Skill Structure

A skill is a directory containing a `SKILL.md` file.

```text
my-skill/
├── SKILL.md          # Main skill definition (required)
├── reference.md      # Supporting documentation (optional)
├── scripts/          # Custom scripts (optional)
└── templates/        # Code templates (optional)
```

## The `SKILL.md` File

The `SKILL.md` file uses YAML frontmatter for configuration and Markdown for instructions. When `context: fork` is used, the Markdown body is passed as the initial prompt to the subagent.

```markdown
---
name: my-skill
description: A brief description of what the skill does.
context: fork
allowed-tools:
  - Bash
  - Read
---

# My Skill Instructions

When this skill is invoked, follow these steps:
1. Use the `Read` tool to examine the project structure.
2. Use the `Bash` tool to run `npm test`.
```

### YAML Frontmatter Fields

- `name`: (Required) Unique identifier (lowercase, numbers, hyphens).
- `description`: (Required) Explains when the AI should use this skill.
- `allowed-tools`: (Optional) List of tools the skill can use.
- `context: fork`: (Optional) Run the skill in a separate subagent.
- `agent`: (Optional) Specify the subagent type (default: `general-purpose`).
- `disable-model-invocation`: (Optional, default: `false`) Set to `true` to hide the skill from the AI's available skills list. The skill can still be invoked by users via slash commands.
- `user-invocable`: (Optional, default: `true`) Set to `false` to hide the skill from the `/` slash command menu. The AI can still invoke it unless `disable-model-invocation` is also set.
- `model`: (Optional) Override the AI model used for skill execution (e.g., `"gpt-4o"`, `"o3-mini"`).

## Skill Locations

Wave looks for skills in two locations:

1.  **User Skills**: `~/.wave/skills/` (Available in all projects)
2.  **Project Skills**: `.wave/skills/` (Specific to the current project)

Project skills take precedence over user skills with the same name.

## Invoking Skills

- **AI-Invoked**: The agent automatically discovers and uses skills based on their `description`.
- **User-Invoked**: Use slash commands in the CLI (e.g., `/my-skill`).

## Inline Bash Commands

You can embed bash commands in skill content using the `!`command`` syntax. The command will be executed and its output will be inserted inline.

```markdown
# Example Skill

Current git status: !`git status --short`

The above command will be replaced with the actual output when the skill is invoked.
```

## Best Practices

- **Clear Descriptions**: Write descriptions that help the AI understand exactly when the skill is relevant.
- **Modular Design**: Keep skills focused on a single task or capability.
- **Use `${WAVE_SKILL_DIR}`**: Use this placeholder to reference files within the skill directory.
- **Inline Bash Commands**: Use `!`command`` to execute bash commands and insert their output inline.
