# Quickstart: Creating and Using Agent Skills

Agent Skills allow you to package expertise into discoverable capabilities that Wave can use autonomously or that you can trigger manually.

## Creating a Skill

A skill is a directory containing a `SKILL.md` file and optional supporting files.

### 1. Choose a Location

- **Personal Skills**: Available across all your projects.
  - Store in: `~/.wave/skills/my-skill-name/`
- **Project Skills**: Shared with your team and version-controlled.
  - Store in: `.wave/skills/my-skill-name/` (within your project root)

### 2. Create SKILL.md

Create a `SKILL.md` file with YAML frontmatter and Markdown content.

```markdown
---
name: my-skill-name
description: A brief description of what the skill does and when the AI should use it.
allowed-tools: [Bash, Read, Write] # Optional: Restrict tools available to the AI
context: fork # Optional: Run in a separate subagent
agent: general-purpose # Optional: Specify agent type for fork context
model: gpt-4o # Optional: Override model for skill execution
disable-model-invocation: false # Optional: Set to true to prevent AI from auto-triggering
user-invocable: true # Optional: Set to false to hide from / menu
---

# My Skill Name

Instructions for the AI on how to perform this skill.
You can use placeholders like $1, $2, or $ARGUMENTS for manual invocation.
You can also execute bash commands using `!`command`` (inline) or ` ```! command ``` ` (block) syntax.
```

### 3. Add Supporting Files (Optional)

You can add other files in the same directory and reference them in `SKILL.md`. The AI will read them only when needed.

```
.wave/skills/my-skill-name/
├── SKILL.md
├── template.txt
└── helper.py
```

## Using Skills

### AI Invocation (Autonomous)

Wave's AI autonomously decides when to use a skill based on its `description`. If your request matches a skill's purpose, the AI will invoke it automatically.

### Slash Commands (Manual)

You can explicitly trigger a skill using a slash command:

```bash
/my-skill-name some arguments
```

- **Arguments**: If your `SKILL.md` contains `$1`, `$2`, etc., or `$ARGUMENTS`, they will be replaced by the text you provide.
- **Path Placeholder**: Use `${WAVE_SKILL_DIR}` in your `SKILL.md` to reference the skill's absolute directory path. This is useful for scripts or templates within the skill directory.
- **Bash Commands**: Any `!`command`` (inline) or ` ```! command ``` ` (block) in the `SKILL.md` will be executed, and its **raw stdout** will be included in the prompt sent to the AI. Output is capped at 30,000 characters per command (with preview + temp file for larger output). If you want the output to appear in a code block, you should wrap the command in a markdown code block.

## Control Flags

- `disable-model-invocation: true`: The AI will not see this skill in its "Available skills" list and cannot trigger it autonomously. It can still be used via slash commands.
- `user-invocable: false`: The skill will not appear in the `/` autocomplete menu and cannot be triggered manually. The AI can still use it if `disable-model-invocation` is not true.

## Best Practices

- **Descriptive Names**: Use lowercase letters, numbers, and hyphens (e.g., `deploy-service`).
- **Clear Descriptions**: The description is how the AI discovers the skill. Be specific about *what* it does and *when* to use it.
- **Tool Restriction**: Use `allowed-tools` to ensure the AI stays focused and secure when performing the skill.
- **Progressive Disclosure**: Keep `SKILL.md` focused and put large amounts of data or complex scripts in supporting files.
