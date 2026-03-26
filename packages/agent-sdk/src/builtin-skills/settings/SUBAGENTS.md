# Creating and Managing Wave Subagents

Subagents are specialized AI personalities that Wave can delegate tasks to. They have their own context windows, expertise areas, and tool configurations.

## Subagent Structure

A subagent is defined by a Markdown file with YAML frontmatter.

```text
.wave/agents/
└── my-subagent.md    # Subagent definition
```

## The `subagent.md` File

The `subagent.md` file uses YAML frontmatter for configuration and Markdown for the system prompt.

```markdown
---
name: my-subagent
description: A specialized subagent for a specific task.
tools:
  - Bash
  - Read
model: gemini-3-flash
---

# My Subagent System Prompt

You are a specialized subagent for a specific task. Your goal is to:
1. Use the `Read` tool to examine the project structure.
2. Use the `Bash` tool to run `npm test`.
```

### YAML Frontmatter Fields

- `name`: (Required) Unique identifier.
- `description`: (Required) Explains the subagent's expertise and when to use it.
- `tools`: (Optional) List of tools the subagent can use.
- `model`: (Optional) Overrides the default model for this subagent.

## Subagent Locations

Wave looks for subagents in two locations:

1.  **User Subagents**: `~/.wave/agents/` (Available in all projects)
2.  **Project Subagents**: `.wave/agents/` (Specific to the current project)

Project subagents take precedence over user subagents with the same name.

## Delegating to Subagents

- **Automatic Delegation**: Wave automatically recognizes when a task matches a subagent's expertise and delegates to it.
- **Explicit Delegation**: You can explicitly request a specific subagent for a task.

## Best Practices

- **Focused Expertise**: Define subagents with clear, specific roles (e.g., "Testing Expert", "Refactoring Specialist").
- **Detailed System Prompts**: Provide clear instructions and guidelines in the system prompt to ensure consistent behavior.
- **Tool Selection**: Only provide the tools that are necessary for the subagent's role.
