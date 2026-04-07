# Contract: Settings Skill Interaction

The `settings` skill is a builtin skill that helps users manage their Wave configuration.

## Skill Metadata
- **Name**: `settings`
- **Description**: Manage Wave settings and get guidance on settings.json
- **Allowed Tools**: `Bash`, `Read`, `Write`

## Interaction Flow

1.  **Discovery**: The agent discovers the `settings` skill during initialization.
2.  **Invocation**: The user invokes the skill via `/settings` or by asking about settings.
3.  **Guidance**: The skill provides a clear explanation of `settings.json` structure and available fields.
4.  **Exploration**: The skill helps the user explore their current settings in different scopes.
5.  **Modification**: The skill guides the user through updating settings in the appropriate scope.
6.  **Validation**: The skill ensures that any changes made to `settings.json` are valid.

## Supported Settings

### settings.json
- `hooks`: Configure automation hooks.
- `env`: Set environment variables.
- `permissions`: Manage tool permissions.
- `enabledPlugins`: Enable or disable plugins.
- `language`: Set preferred language.
- `autoMemoryEnabled`: Enable/disable auto-memory.
- `autoMemoryFrequency`: Frequency of auto-memory extraction.
- `models`: Model-specific configuration overrides.

### Other Files
- `.mcp.json`: Configure external MCP servers.
- `.wave/rules/*.md`: Define context-specific instructions (Memory Rules).
- `.wave/skills/`: Create and manage custom skills.
- `.wave/agents/`: Create and manage specialized subagents.

## Documentation Links
- `SKILL.md`: Main skill documentation.
- `HOOKS.md`: Detailed documentation for complex hook configurations.
- `ENV.md`: Environment variable configuration.
- `MCP.md`: Model Context Protocol configuration.
- `MEMORY_RULES.md`: Memory rules and auto-memory configuration.
- `SKILLS.md`: Creating and managing custom skills.
- `SUBAGENTS.md`: Creating and managing specialized subagents.

## Inline Bash Commands

Skills support inline bash command execution using the `!`command`` syntax. When a skill is invoked, any bash commands wrapped in `!`...`` will be executed and the output will be inserted inline.

Example:
```markdown
Current branch: !`git branch --show-current`
```

This is useful for skills that need to display dynamic information about the current project state.
