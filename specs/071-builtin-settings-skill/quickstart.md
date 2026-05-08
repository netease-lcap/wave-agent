# Quickstart: Builtin Settings Skill

The `settings` skill helps you manage your Wave configuration and provides guidance on how to write `settings.json`.

## Usage

To use the `settings` skill, simply ask the agent to help you with your settings:

```text
/settings
```

Or ask specific questions:

- "How do I configure hooks in settings.json?"
- "Show me my current settings."
- "Enable the 'git' plugin in my project settings."

## Configuration Scopes

Wave supports three configuration scopes:

1.  **User**: `~/.wave/settings.json` (Global settings for all projects)
2.  **Project**: `.wave/settings.json` (Project-specific settings, shared via git)
3.  **Local**: `.wave/settings.local.json` (Local overrides, ignored by git)

## Available Settings

### settings.json
- **hooks**: Automate actions at specific workflow points (e.g., `PreToolUse`, `WorktreeCreate`).
- **env**: Set environment variables for the agent and hooks.
- **permissions**: Manage tool permissions and safe zones.
- **enabledPlugins**: Enable or disable specific plugins.
- **language**: Set your preferred language for agent communication.
- **autoMemoryEnabled**: Enable or disable the auto-memory feature.
- **autoMemoryFrequency**: Frequency of auto-memory extraction turns.
- **models**: Model-specific configuration overrides (e.g., `thinking`, `reasoning_effort`).

### Other Configuration Files
- **.mcp.json**: Configure external MCP servers for additional tools and context.
- **.wave/rules/**: Define context-specific instructions and guidelines (Memory Rules).
- **.wave/skills/**: Create and manage custom skills.
- **.wave/agents/**: Create and manage specialized subagents.

## Detailed Documentation

For more information on complex configurations, see the following files linked from the `settings` skill:
- `HOOKS.md`: Detailed hook configuration.
- `ENV.md`: Environment variable configuration.
- `MCP.md`: Model Context Protocol configuration.
- `MEMORY_RULES.md`: Memory rules and auto-memory configuration.
- `SKILLS.md`: Creating and managing custom skills.
- `SUBAGENTS.md`: Creating and managing specialized subagents.

## Inline Bash Commands in Skills

Skills support inline bash command execution using the `!`command`` syntax. The command output is inserted inline when the skill is invoked:

```markdown
Current directory: !`pwd`
Git status: !`git status --short`
```

This is useful for displaying dynamic project information in skill content.
