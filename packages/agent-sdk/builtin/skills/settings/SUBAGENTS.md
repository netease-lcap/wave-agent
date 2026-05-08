# Creating and Managing Wave Subagents

Subagents are specialized AI personalities that Wave can delegate tasks to. They have their own context windows, expertise areas, and tool configurations.

## Subagent Structure

A subagent is defined by a Markdown file with YAML frontmatter.

```text
.wave/agents/
└── my-subagent.md    # Subagent definition
```

## The `subagent.md` File

The `subagent.md` file uses YAML frontmatter for configuration and Markdown for the system prompt. The Markdown content (excluding frontmatter) is passed directly as the system prompt to the subagent. Avoid using top-level Markdown headers (like `# My Subagent`) unless you want them to be part of the system prompt.

```markdown
---
name: my-subagent
description: A specialized subagent for a specific task.
tools:
  - Bash
  - Read
model: gemini-3-flash
---

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

Wave looks for subagents in three locations:

1.  **User Subagents**: `~/.wave/agents/` (Available in all projects)
2.  **Project Subagents**: `.wave/agents/` (Specific to the current project)
3.  **Plugin Agents**: `agents/` within an installed plugin directory (Scoped to the plugin)

Project subagents take precedence over user subagents with the same name. Plugin agents are namespaced with the plugin name (e.g., `pluginName:agentName`) to avoid collisions.

## Plugin Agents

Plugins can define their own subagents in an `agents/` directory within the plugin. These agents can reference their parent plugin's directory using the `${WAVE_PLUGIN_ROOT}` template variable, which is substituted at load time.

For example, a plugin at `/path/to/my-plugin/` with `agents/researcher.md`:

```markdown
---
name: researcher
description: A research agent that uses the plugin's knowledge base
tools: ["Read", "Glob"]
---

You are a research assistant. Access plugin resources at ${WAVE_PLUGIN_ROOT}/data.
```

After loading, `${WAVE_PLUGIN_ROOT}` is replaced with `/path/to/my-plugin/`, and the agent is registered as `my-plugin:researcher`.

## Delegating to Subagents

- **Automatic Delegation**: Wave automatically recognizes when a task matches a subagent's expertise and delegates to it.
- **Explicit Delegation**: You can explicitly request a specific subagent for a task.

## Best Practices

- **Focused Expertise**: Define subagents with clear, specific roles (e.g., "Testing Expert", "Refactoring Specialist").
- **Detailed System Prompts**: Provide clear instructions and guidelines in the system prompt to ensure consistent behavior.
- **Tool Selection**: Only provide the tools that are necessary for the subagent's role.
