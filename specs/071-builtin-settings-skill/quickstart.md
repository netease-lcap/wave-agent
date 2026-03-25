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

- **hooks**: Automate actions at specific workflow points (e.g., `PreToolUse`, `WorktreeCreate`).
- **env**: Set environment variables for the agent and hooks.
- **permissions**: Manage tool permissions and safe zones.
- **enabledPlugins**: Enable or disable specific plugins.
- **language**: Set your preferred language for agent communication.
- **autoMemoryEnabled**: Enable or disable the auto-memory feature.

## Detailed Documentation

For more information on complex hook configurations and environment variables, see the `HOOKS.md` and `ENV.md` files linked from the `settings` skill.
